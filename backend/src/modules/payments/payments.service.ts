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
  PaymentStatus,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { dayStart } from '../../common/utils/dates';
import { formatINR, money, sum, toDb } from '../../common/utils/money';
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
  /** Required for CASH_AND_UPI; the two must add up to `amount`. */
  cashAmount?: string;
  upiAmount?: string;
  paidAt: string;
  reference?: string;
  notes?: string;
  /** Apply to these bills in order; otherwise oldest bills are paid first. */
  invoiceIds?: string[];
  /** Records an identical payment that would otherwise look like a duplicate. */
  allowDuplicate?: boolean;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records money received.
   *
   * The money is only applied to bills once the payment is VERIFIED. Someone
   * who can approve payments has their own entries approved on the spot;
   * everyone else's wait, so a staff member cannot clear a tenant's balance
   * without a second pair of eyes.
   */
  async record(
    input: RecordPaymentInput,
    actorId: string,
    options: { canApprove: boolean },
  ) {
    const amount = money(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Payment amount must be more than zero');
    }

    const paidAt = dayStart(input.paidAt);
    // Backdating is normal — money often gets entered days later. Forward
    // dating is not: it would make a bill look settled before it was.
    if (paidAt > dayStart(new Date())) {
      throw new BadRequestException(
        'A payment cannot be dated in the future. Record it on the day it was received.',
      );
    }

    const method = input.method ?? PaymentMethod.CASH;
    const { cashAmount, upiAmount } = this.resolveSplit(method, amount, input);

    return this.prisma.runInTransaction(async (tx) => {
      const stay = await tx.stay.findUnique({
        where: { id: input.stayId },
        include: { tenant: true },
      });
      if (!stay) throw new NotFoundException('Stay not found');

      await this.assertNotDuplicate(tx, input, amount, paidAt);

      const requireVerification = await this.settings.getBoolean(
        SETTING_KEYS.PAYMENT_REQUIRE_VERIFICATION,
      );
      const verified = options.canApprove || !requireVerification;

      const receiptNo = await this.nextReceiptNumber(tx);
      const payment = await tx.payment.create({
        data: {
          receiptNo,
          stayId: input.stayId,
          amount: toDb(amount),
          cashAmount: toDb(cashAmount),
          upiAmount: toDb(upiAmount),
          method,
          status: verified ? PaymentStatus.VERIFIED : PaymentStatus.SUBMITTED,
          verifiedById: verified ? actorId : null,
          verifiedAt: verified ? new Date() : null,
          paidAt,
          reference: input.reference,
          notes: input.notes,
          receivedById: actorId,
        },
      });

      const allocations = verified
        ? await this.allocate(tx, payment.id, input.stayId, amount, input.invoiceIds)
        : { applied: [], remaining: amount };

      await this.audit.record({
        tx,
        actorId,
        action: verified ? 'payment.record_verified' : 'payment.record_submitted',
        entityType: 'Payment',
        entityId: payment.id,
        after: {
          receiptNo,
          amount: amount.toFixed(2),
          method,
          cashAmount: cashAmount.toFixed(2),
          upiAmount: upiAmount.toFixed(2),
          status: payment.status,
          allocations: allocations.applied,
          unallocated: allocations.remaining.toFixed(2),
        },
      });

      return {
        payment,
        allocations: allocations.applied,
        unallocated: allocations.remaining.toFixed(2),
        tenantName: stay.tenant.fullName,
        awaitingApproval: !verified,
      };
    });
  }

  /**
   * Approves collected money, which is the point at which it reaches the
   * ledger. Allocation happens here rather than at recording time.
   */
  async verify(paymentId: string, actorId: string, invoiceIds?: string[]) {
    return this.prisma.runInTransaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status === PaymentStatus.VERIFIED) {
        throw new BadRequestException('This payment has already been approved');
      }
      if (payment.status === PaymentStatus.REJECTED) {
        throw new BadRequestException(
          'This payment was rejected. Record a new one instead of approving it.',
        );
      }

      const amount = money(payment.amount);
      const allocations = await this.allocate(
        tx,
        payment.id,
        payment.stayId,
        amount,
        invoiceIds,
      );

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.VERIFIED,
          verifiedById: actorId,
          verifiedAt: new Date(),
        },
      });

      await this.audit.record({
        tx,
        actorId,
        action: 'payment.verify',
        entityType: 'Payment',
        entityId: paymentId,
        before: { status: payment.status },
        after: {
          status: PaymentStatus.VERIFIED,
          allocations: allocations.applied,
          unallocated: allocations.remaining.toFixed(2),
        },
      });

      return { payment: updated, ...allocations };
    });
  }

  /** Rejects collected money with a mandatory reason. Nothing is allocated. */
  async reject(paymentId: string, reason: string, actorId: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to reject a payment');
    }
    return this.prisma.runInTransaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status === PaymentStatus.VERIFIED) {
        throw new BadRequestException(
          'This payment has been approved. Reverse it instead of rejecting it.',
        );
      }

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.REJECTED,
          rejectionReason: reason,
          verifiedById: actorId,
          verifiedAt: new Date(),
        },
      });

      await this.audit.record({
        tx,
        actorId,
        action: 'payment.reject',
        entityType: 'Payment',
        entityId: paymentId,
        before: { status: payment.status },
        after: { status: PaymentStatus.REJECTED },
        reason,
      });
      return updated;
    });
  }

  /**
   * Applies money to bills, oldest due first, and returns what stuck.
   * Anything left over after every bill is clear is held as an advance.
   */
  private async allocate(
    tx: Db,
    paymentId: string,
    stayId: string,
    amount: Decimal,
    invoiceIds?: string[],
  ): Promise<{
    applied: Array<{ invoiceId: string; number: string; amount: string }>;
    remaining: Decimal;
  }> {
    const targets = invoiceIds?.length
      ? await tx.invoice.findMany({
          where: { id: { in: invoiceIds }, stayId },
          orderBy: { periodStart: 'asc' },
        })
      : await tx.invoice.findMany({
          where: {
            stayId,
            status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
          },
          orderBy: [{ dueDate: 'asc' }, { periodStart: 'asc' }],
        });

    let remaining = amount;
    const applied: Array<{ invoiceId: string; number: string; amount: string }> = [];

    for (const invoice of targets) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const due = money(invoice.totalAmount).minus(money(invoice.paidAmount));
      if (due.lessThanOrEqualTo(0)) continue;

      const applying = Decimal.min(due, remaining);
      await tx.paymentAllocation.create({
        data: { paymentId, invoiceId: invoice.id, amount: toDb(applying) },
      });

      const newPaid = money(invoice.paidAmount).plus(applying);
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: toDb(newPaid),
          status: newPaid.greaterThanOrEqualTo(money(invoice.totalAmount))
            ? InvoiceStatus.PAID
            : InvoiceStatus.PARTIALLY_PAID,
        },
      });

      applied.push({
        invoiceId: invoice.id,
        number: invoice.number,
        amount: applying.toFixed(2),
      });
      remaining = remaining.minus(applying);
    }

    return { applied, remaining };
  }

  /** Splits a payment across cash and UPI, and checks the parts add up. */
  private resolveSplit(
    method: PaymentMethod,
    amount: Decimal,
    input: RecordPaymentInput,
  ): { cashAmount: Decimal; upiAmount: Decimal } {
    if (method === PaymentMethod.CASH_AND_UPI) {
      const cashAmount = money(input.cashAmount ?? 0);
      const upiAmount = money(input.upiAmount ?? 0);
      if (cashAmount.lessThan(0) || upiAmount.lessThan(0)) {
        throw new BadRequestException('Cash and UPI amounts cannot be negative');
      }
      if (!cashAmount.plus(upiAmount).equals(amount)) {
        throw new BadRequestException(
          `The cash (${formatINR(cashAmount)}) and UPI (${formatINR(
            upiAmount,
          )}) amounts add up to ${formatINR(
            cashAmount.plus(upiAmount),
          )}, but the total is ${formatINR(amount)}.`,
        );
      }
      return { cashAmount, upiAmount };
    }
    if (method === PaymentMethod.UPI) {
      return { cashAmount: new Decimal(0), upiAmount: amount };
    }
    if (method === PaymentMethod.CASH) {
      return { cashAmount: amount, upiAmount: new Decimal(0) };
    }
    return { cashAmount: new Decimal(0), upiAmount: new Decimal(0) };
  }

  /**
   * Catches the same payment being entered twice — a genuinely common mistake
   * when two people are collecting rent on the same evening.
   */
  private async assertNotDuplicate(
    tx: Db,
    input: RecordPaymentInput,
    amount: Decimal,
    paidAt: Date,
  ): Promise<void> {
    if (input.allowDuplicate) return;

    const windowMinutes = await this.settings.getInt(
      SETTING_KEYS.PAYMENT_DUPLICATE_WINDOW_MINUTES,
    );
    if (windowMinutes <= 0) return;

    const since = new Date(Date.now() - windowMinutes * 60_000);
    const existing = await tx.payment.findFirst({
      where: {
        stayId: input.stayId,
        amount: toDb(amount),
        paidAt,
        createdAt: { gte: since },
        status: { not: PaymentStatus.REJECTED },
        reversedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      throw new BadRequestException(
        `${formatINR(amount)} was already recorded for this tenant on the same date a few minutes ago (${
          existing.receiptNo
        }). If this is a second, separate payment, confirm it to record it anyway.`,
      );
    }
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
      if (payment.status !== PaymentStatus.VERIFIED) {
        throw new BadRequestException(
          'Only an approved payment can be reversed. Reject it instead.',
        );
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
          status: PaymentStatus.VERIFIED,
          verifiedById: actorId,
          verifiedAt: new Date(),
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
    status?: PaymentStatus[];
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 25, 200);

    const where = {
      stayId: filter.stayId,
      status: filter.status ? { in: filter.status } : undefined,
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

  /** Money collected but not yet approved — the approve queue. */
  async awaitingApproval(branchId?: string) {
    const items = await this.prisma.payment.findMany({
      where: {
        status: { in: [PaymentStatus.PENDING, PaymentStatus.SUBMITTED] },
        stay: branchId
          ? {
              assignments: {
                some: { bed: { room: { floor: { branchId } } } },
              },
            }
          : undefined,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        stay: {
          include: {
            tenant: { select: { id: true, fullName: true } },
            assignments: {
              where: { endDate: null },
              take: 1,
              include: { bed: { include: { room: true } } },
            },
          },
        },
      },
    });

    return {
      count: items.length,
      totalAmount: sum(items.map((p) => p.amount)).toFixed(2),
      items: items.map((p) => ({
        id: p.id,
        receiptNo: p.receiptNo,
        stayId: p.stayId,
        tenantId: p.stay.tenantId,
        tenantName: p.stay.tenant.fullName,
        roomName: p.stay.assignments[0]?.bed.room.name ?? null,
        amount: money(p.amount).toFixed(2),
        cashAmount: money(p.cashAmount).toFixed(2),
        upiAmount: money(p.upiAmount).toFixed(2),
        method: p.method,
        status: p.status,
        paidAt: p.paidAt,
        reference: p.reference,
        recordedAt: p.createdAt,
      })),
    };
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
