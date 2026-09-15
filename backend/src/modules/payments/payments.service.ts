import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DepositEntryType,
  DepositStatus,
  InvoiceStatus,
  PaymentMethod,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { dayStart } from '../../common/utils/dates';
import { money, sum, toDb } from '../../common/utils/money';
import { AuditService } from '../audit/audit.service';
import { SETTING_KEYS } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';

/** Deposit movements that release money rather than take it in. */
const OUTGOING_DEPOSIT_TYPES: DepositEntryType[] = [
  DepositEntryType.REFUNDED,
  DepositEntryType.ADJUSTED_AGAINST_DUES,
  DepositEntryType.FORFEITED,
];

export interface RecordPaymentInput {
  stayId: string;
  amount: string;
  method?: PaymentMethod;
  paidAt: string;
  reference?: string;
  notes?: string;
  /** Apply to these bills in order; otherwise oldest bills are paid first. */
  invoiceIds?: string[];
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records money received and applies it to bills.
   *
   * Allocation is explicit: every rupee lands on a specific bill, so a
   * tenant's balance is always derivable from records rather than from a
   * mutable running total. Anything left over after all bills are cleared is
   * held as an advance and applied to the next bill.
   */
  async record(input: RecordPaymentInput, actorId: string) {
    const amount = money(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Payment amount must be more than zero');
    }

    return this.prisma.runInTransaction(async (tx) => {
      const stay = await tx.stay.findUnique({
        where: { id: input.stayId },
        include: { tenant: true },
      });
      if (!stay) throw new NotFoundException('Stay not found');

      const receiptNo = await this.nextReceiptNumber(tx);
      const payment = await tx.payment.create({
        data: {
          receiptNo,
          stayId: input.stayId,
          amount: toDb(amount),
          method: input.method ?? PaymentMethod.CASH,
          paidAt: dayStart(input.paidAt),
          reference: input.reference,
          notes: input.notes,
          receivedById: actorId,
        },
      });

      const targets = input.invoiceIds?.length
        ? await tx.invoice.findMany({
            where: { id: { in: input.invoiceIds }, stayId: input.stayId },
            orderBy: { periodStart: 'asc' },
          })
        : await tx.invoice.findMany({
            where: {
              stayId: input.stayId,
              status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
            },
            orderBy: [{ dueDate: 'asc' }, { periodStart: 'asc' }],
          });

      let remaining = amount;
      const allocations: Array<{ invoiceId: string; number: string; amount: string }> = [];

      for (const invoice of targets) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const due = money(invoice.totalAmount).minus(money(invoice.paidAmount));
        if (due.lessThanOrEqualTo(0)) continue;

        const applied = Decimal.min(due, remaining);
        await tx.paymentAllocation.create({
          data: { paymentId: payment.id, invoiceId: invoice.id, amount: toDb(applied) },
        });

        const newPaid = money(invoice.paidAmount).plus(applied);
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: toDb(newPaid),
            status: newPaid.greaterThanOrEqualTo(money(invoice.totalAmount))
              ? InvoiceStatus.PAID
              : InvoiceStatus.PARTIALLY_PAID,
          },
        });

        allocations.push({
          invoiceId: invoice.id,
          number: invoice.number,
          amount: applied.toFixed(2),
        });
        remaining = remaining.minus(applied);
      }

      await this.audit.record({
        tx,
        actorId,
        action: 'payment.record',
        entityType: 'Payment',
        entityId: payment.id,
        after: {
          receiptNo,
          amount: amount.toFixed(2),
          allocations,
          unallocated: remaining.toFixed(2),
        },
      });

      return {
        payment,
        allocations,
        unallocated: remaining.toFixed(2),
        tenantName: stay.tenant.fullName,
      };
    });
  }

  /**
   * Reverses a payment by writing an opposite entry and unwinding its
   * allocations. The original row stays exactly as it was recorded.
   */
  async reverse(paymentId: string, reason: string, actorId: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to reverse a payment');
    }

    return this.prisma.runInTransaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { allocations: { include: { invoice: true } } },
      });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.reversedAt) {
        throw new BadRequestException('This payment has already been reversed');
      }

      for (const allocation of payment.allocations) {
        const newPaid = money(allocation.invoice.paidAmount).minus(money(allocation.amount));
        await tx.invoice.update({
          where: { id: allocation.invoiceId },
          data: {
            paidAmount: toDb(Decimal.max(newPaid, 0)),
            status: newPaid.lessThanOrEqualTo(0)
              ? InvoiceStatus.ISSUED
              : InvoiceStatus.PARTIALLY_PAID,
          },
        });
      }
      await tx.paymentAllocation.deleteMany({ where: { paymentId } });

      await tx.payment.update({
        where: { id: paymentId },
        data: { reversedAt: new Date(), notes: appendNote(payment.notes, `Reversed: ${reason}`) },
      });

      const receiptNo = await this.nextReceiptNumber(tx);
      const reversal = await tx.payment.create({
        data: {
          receiptNo,
          stayId: payment.stayId,
          amount: toDb(money(payment.amount).negated()),
          method: payment.method,
          paidAt: new Date(),
          reference: payment.reference,
          notes: `Reversal of ${payment.receiptNo}: ${reason}`,
          reversalOfId: payment.id,
          receivedById: actorId,
        },
      });

      await this.audit.record({
        tx,
        actorId,
        action: 'payment.reverse',
        entityType: 'Payment',
        entityId: paymentId,
        before: { amount: money(payment.amount).toFixed(2) },
        after: { reversalId: reversal.id },
        reason,
      });

      return reversal;
    });
  }

  async listPayments(filter: {
    stayId?: string;
    tenantId?: string;
    branchId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 25, 200);

    const where = {
      stayId: filter.stayId,
      paidAt: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
      stay: {
        tenantId: filter.tenantId,
        ...(filter.branchId
          ? {
              assignments: {
                some: { bed: { room: { floor: { branchId: filter.branchId } } } },
              },
            }
          : {}),
      },
    };

    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          allocations: { include: { invoice: { select: { number: true } } } },
          stay: { include: { tenant: { select: { id: true, fullName: true } } } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      totalAmount: sum(items.map((i) => i.amount)).toFixed(2),
    };
  }

  // --- Deposits ----------------------------------------------------------

  /** Deposit held = the sum of the append-only ledger. */
  async depositBalance(stayId: string, db: Db = this.prisma): Promise<Decimal> {
    const entries = await db.depositEntry.findMany({ where: { stayId } });
    return sum(entries.map((e) => e.amount));
  }

  async depositLedger(stayId: string) {
    const [entries, stay] = await Promise.all([
      this.prisma.depositEntry.findMany({
        where: { stayId },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.stay.findUnique({
        where: { id: stayId },
        include: { settlement: true },
      }),
    ]);
    if (!stay) throw new NotFoundException('Stay not found');

    const held = sum(entries.map((e) => e.amount));
    return {
      agreed: money(stay.depositAmount).toFixed(2),
      held: held.toFixed(2),
      status: stay.settlement?.depositStatus ?? (held.greaterThan(0) ? DepositStatus.HELD : DepositStatus.NONE),
      entries,
    };
  }

  /**
   * Adds a deposit movement. Collections are positive; refunds, forfeits and
   * adjustments against dues are negative. Nothing is ever edited in place.
   */
  async addDepositEntry(
    input: {
      stayId: string;
      type: DepositEntryType;
      amount: string;
      method?: PaymentMethod;
      occurredAt: string;
      reason?: string;
      notes?: string;
    },
    actorId: string,
  ) {
    const magnitude = money(input.amount).abs();
    if (magnitude.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Amount must be more than zero');
    }

    const outgoing = OUTGOING_DEPOSIT_TYPES.includes(input.type);

    const signed =
      input.type === DepositEntryType.CORRECTION
        ? money(input.amount)
        : outgoing
          ? magnitude.negated()
          : magnitude;

    if (outgoing && !input.reason?.trim()) {
      throw new BadRequestException('A reason is required when releasing a deposit');
    }

    return this.prisma.runInTransaction(async (tx) => {
      const held = await this.depositBalance(input.stayId, tx);
      if (outgoing && magnitude.greaterThan(held)) {
        throw new BadRequestException(
          `Only ₹${held.toFixed(2)} is held for this tenant; you cannot release ₹${magnitude.toFixed(2)}.`,
        );
      }

      const entry = await tx.depositEntry.create({
        data: {
          stayId: input.stayId,
          type: input.type,
          amount: toDb(signed),
          method: input.method,
          occurredAt: dayStart(input.occurredAt),
          reason: input.reason,
          notes: input.notes,
          createdById: actorId,
        },
      });

      // Keep the settlement's deposit status in step with the ledger.
      const settlement = await tx.settlement.findUnique({
        where: { stayId: input.stayId },
      });
      if (settlement) {
        const remaining = held.plus(signed);
        const refunded = sum(
          (
            await tx.depositEntry.findMany({
              where: { stayId: input.stayId, type: DepositEntryType.REFUNDED },
            })
          ).map((e) => e.amount),
        ).abs();

        let status: DepositStatus = settlement.depositStatus;
        if (remaining.lessThanOrEqualTo(0)) {
          status =
            input.type === DepositEntryType.ADJUSTED_AGAINST_DUES
              ? DepositStatus.ADJUSTED_AGAINST_DUES
              : DepositStatus.FULLY_REFUNDED;
        } else if (refunded.greaterThan(0)) {
          status = DepositStatus.PARTIALLY_REFUNDED;
        }
        await tx.settlement.update({
          where: { id: settlement.id },
          data: { depositStatus: status },
        });
      }

      await this.audit.record({
        tx,
        actorId,
        action: `deposit.${input.type.toLowerCase()}`,
        entityType: 'DepositEntry',
        entityId: entry.id,
        after: { ...input, signedAmount: signed.toFixed(2) },
        reason: input.reason,
      });

      return entry;
    });
  }

  private async nextReceiptNumber(tx: Db): Promise<string> {
    const prefix = await this.settings.rawInTx(tx, SETTING_KEYS.RECEIPT_PREFIX);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const count = await tx.payment.count({
      where: { receiptNo: { startsWith: `${prefix}-${stamp}-` } },
    });
    return `${prefix}-${stamp}-${String(count + 1).padStart(4, '0')}`;
  }
}

function appendNote(existing: string | null, note: string): string {
  return existing ? `${existing}\n${note}` : note;
}
