import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentEndReason,
  ChargeKind,
  DepositEntryType,
  DepositStatus,
  InvoiceStatus,
  SettlementStatus,
  StayStatus,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import {
  addDaysTo,
  dayStart,
  inclusiveDays,
  toDateOnlyString,
} from '../../common/utils/dates';
import { money, round2, sum, toDb } from '../../common/utils/money';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { PaymentsService } from '../payments/payments.service';
import { PricingService } from '../pricing/pricing.service';
import type { VacateDto } from '../tenants/dto';

export interface SettlementLineDraft {
  kind: ChargeKind;
  description: string;
  amount: Decimal;
  isManual: boolean;
  reason?: string;
  calcSnapshot?: unknown;
}

export interface SettlementPreview {
  stayId: string;
  tenantName: string;
  checkoutDate: Date;
  depositHeld: Decimal;
  lines: SettlementLineDraft[];
  totalDeductions: Decimal;
  /** Positive: refund due to the tenant. Negative: the tenant owes the PG. */
  netAmount: Decimal;
  notice: {
    noticeDate: Date;
    requiredUntilDate: Date;
    noticeDaysRequired: number;
    shortfallDays: number;
    charge: Decimal;
  } | null;
  warnings: string[];
}

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly payments: PaymentsService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Builds the final settlement without saving it — the screen the owner
   * reviews before confirming a vacate.
   *
   * Deductions, in order:
   *   1. Anything still unpaid on bills already issued.
   *   2. Charges for the days since the last bill, up to the checkout date.
   *   3. Notice-period charges when the tenant left short of their notice.
   *   4. Manual adjustments already recorded on a draft settlement.
   */
  async preview(
    stayId: string,
    checkoutDate: Date,
    db: Db = this.prisma,
  ): Promise<SettlementPreview> {
    const checkout = dayStart(checkoutDate);
    const warnings: string[] = [];

    const stay = await db.stay.findUnique({
      where: { id: stayId },
      include: {
        tenant: true,
        notice: true,
        settlement: { include: { lines: true } },
      },
    });
    if (!stay) throw new NotFoundException('Stay not found');
    if (checkout < dayStart(stay.checkInDate)) {
      throw new BadRequestException('Checkout cannot be before check-in');
    }

    const lines: SettlementLineDraft[] = [];

    // 1. Unpaid balances on issued bills.
    const outstanding = await this.billing.outstandingForStay(stayId, db);
    for (const invoice of outstanding.unpaid) {
      const balance = money(invoice.totalAmount).minus(money(invoice.paidAmount));
      if (balance.lessThanOrEqualTo(0)) continue;
      lines.push({
        kind: ChargeKind.OTHER,
        description: `Unpaid bill ${invoice.number} (${toDateOnlyString(
          invoice.periodStart,
        )} to ${toDateOnlyString(invoice.periodEnd)})`,
        amount: balance,
        isManual: false,
        calcSnapshot: {
          invoiceId: invoice.id,
          total: money(invoice.totalAmount).toFixed(2),
          paid: money(invoice.paidAmount).toFixed(2),
        },
      });
    }

    // 2. Unbilled days up to checkout.
    const lastBilled = await db.invoice.findFirst({
      where: { stayId, status: { not: InvoiceStatus.CANCELLED } },
      orderBy: { periodEnd: 'desc' },
    });
    const unbilledFrom = lastBilled
      ? addDaysTo(dayStart(lastBilled.periodEnd), 1)
      : dayStart(stay.checkInDate);

    if (unbilledFrom <= checkout) {
      const computed = await this.billing.computeCharges(
        stayId,
        unbilledFrom,
        checkout,
        db,
      );
      for (const line of computed.lines) {
        lines.push({
          kind: line.kind,
          description: `${line.description} — up to checkout`,
          amount: line.amount,
          isManual: false,
          calcSnapshot: line.calcSnapshot,
        });
      }
    }

    // 3. Notice period shortfall.
    let noticeInfo: SettlementPreview['notice'] = null;
    if (stay.notice) {
      const requiredUntil = dayStart(stay.notice.requiredUntilDate);
      const shortfallDays = Math.max(0, inclusiveDays(checkout, requiredUntil) - 1);
      let charge = new Decimal(0);

      if (shortfallDays > 0) {
        const resolved = await this.pricing.resolveRentForStay(stayId, checkout, db);
        const divisor = inclusiveDays(
          new Date(checkout.getFullYear(), checkout.getMonth(), 1),
          new Date(checkout.getFullYear(), checkout.getMonth() + 1, 0),
        );
        const dailyRent = resolved.monthlyRent.dividedBy(divisor);
        charge = round2(dailyRent.times(shortfallDays));

        lines.push({
          kind: ChargeKind.NOTICE_PERIOD,
          description: `Notice period shortfall — ${shortfallDays} day${
            shortfallDays === 1 ? '' : 's'
          }`,
          amount: charge,
          isManual: false,
          calcSnapshot: {
            noticeDate: toDateOnlyString(stay.notice.noticeDate),
            noticeDaysRequired: stay.notice.noticeDaysRequired,
            requiredUntilDate: toDateOnlyString(requiredUntil),
            actualCheckout: toDateOnlyString(checkout),
            shortfallDays,
            monthlyRent: resolved.monthlyRent.toFixed(2),
            dailyRent: round2(dailyRent).toFixed(2),
          },
        });
      }

      noticeInfo = {
        noticeDate: stay.notice.noticeDate,
        requiredUntilDate: requiredUntil,
        noticeDaysRequired: stay.notice.noticeDaysRequired,
        shortfallDays,
        charge,
      };
    } else {
      warnings.push(
        'No notice was recorded for this tenant, so no notice-period charge has been applied.',
      );
    }

    // 4. Manual adjustments already on the draft.
    for (const line of stay.settlement?.lines.filter((l) => l.isManual) ?? []) {
      lines.push({
        kind: line.kind,
        description: line.description,
        amount: money(line.amount),
        isManual: true,
        reason: line.reason ?? undefined,
      });
    }

    const depositHeld = await this.payments.depositBalance(stayId, db);
    const totalDeductions = sum(lines.map((l) => l.amount));
    const netAmount = depositHeld.minus(totalDeductions);

    if (depositHeld.isZero()) {
      warnings.push('No deposit is held for this tenant.');
    }
    if (netAmount.isNegative()) {
      warnings.push(
        `Deductions exceed the deposit by ₹${netAmount.abs().toFixed(2)}. This amount is payable by the tenant.`,
      );
    }

    return {
      stayId,
      tenantName: stay.tenant.fullName,
      checkoutDate: checkout,
      depositHeld,
      lines,
      totalDeductions,
      netAmount,
      notice: noticeInfo,
      warnings,
    };
  }

  /**
   * Vacates a tenant: closes the stay, frees the bed and records the final
   * settlement. One transaction, so occupancy and money can never disagree.
   */
  async vacate(stayId: string, dto: VacateDto, actorId: string) {
    const checkout = dayStart(dto.checkoutDate);

    return this.prisma.runInTransaction(async (tx) => {
      const stay = await tx.stay.findUnique({
        where: { id: stayId },
        include: { tenant: true },
      });
      if (!stay) throw new NotFoundException('Stay not found');
      if (stay.status === StayStatus.VACATED) {
        throw new BadRequestException('This tenant has already been vacated');
      }

      const preview = await this.preview(stayId, checkout, tx);

      // Close occupancy on the checkout date — the bed is free from the next
      // day and stops appearing in future E.B. and occupancy calculations.
      await tx.bedAssignment.updateMany({
        where: { stayId, endDate: null },
        data: { endDate: checkout, endReason: AssignmentEndReason.VACATED },
      });

      await tx.stay.update({
        where: { id: stayId },
        data: {
          status: StayStatus.VACATED,
          actualCheckoutDate: checkout,
        },
      });

      // Close the open food period so later reporting reads cleanly.
      await tx.foodPeriod.updateMany({
        where: { stayId, effectiveTo: null },
        data: { effectiveTo: checkout },
      });

      const settlement = await tx.settlement.upsert({
        where: { stayId },
        create: {
          stayId,
          status: SettlementStatus.DRAFT,
          checkoutDate: checkout,
          depositHeld: toDb(preview.depositHeld),
          totalDeductions: toDb(preview.totalDeductions),
          netAmount: toDb(preview.netAmount),
          depositStatus: preview.netAmount.greaterThan(0)
            ? DepositStatus.REFUND_PENDING
            : DepositStatus.ADJUSTED_AGAINST_DUES,
          notes: dto.reason,
          createdById: actorId,
        },
        update: {
          checkoutDate: checkout,
          depositHeld: toDb(preview.depositHeld),
          totalDeductions: toDb(preview.totalDeductions),
          netAmount: toDb(preview.netAmount),
        },
      });

      // Rebuild the automatic lines; manual ones are preserved.
      await tx.settlementLine.deleteMany({
        where: { settlementId: settlement.id, isManual: false },
      });
      for (const line of preview.lines.filter((l) => !l.isManual)) {
        await tx.settlementLine.create({
          data: {
            settlementId: settlement.id,
            kind: line.kind,
            description: line.description,
            amount: toDb(line.amount),
            isManual: false,
            calcSnapshot: line.calcSnapshot
              ? JSON.stringify(line.calcSnapshot)
              : null,
            createdById: actorId,
          },
        });
      }

      await this.audit.record({
        tx,
        actorId,
        action: 'stay.vacate',
        entityType: 'Stay',
        entityId: stayId,
        after: {
          checkoutDate: toDateOnlyString(checkout),
          depositHeld: preview.depositHeld.toFixed(2),
          totalDeductions: preview.totalDeductions.toFixed(2),
          netAmount: preview.netAmount.toFixed(2),
        },
        reason: dto.reason,
      });

      if (dto.finaliseSettlement) {
        return this.finaliseInTx(tx, settlement.id, actorId);
      }

      return tx.settlement.findUniqueOrThrow({
        where: { id: settlement.id },
        include: { lines: true, stay: { include: { tenant: true } } },
      });
    });
  }

  /**
   * Adds a manual deduction or credit. Amount, reason and user are all
   * mandatory — that is the rule for every manual financial adjustment.
   */
  async addManualLine(
    settlementId: string,
    input: { kind?: ChargeKind; description: string; amount: string; reason: string },
    actorId: string,
  ) {
    if (!input.reason?.trim()) {
      throw new BadRequestException('A reason is required for a manual adjustment');
    }
    return this.prisma.runInTransaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId },
      });
      if (!settlement) throw new NotFoundException('Settlement not found');
      if (settlement.status === SettlementStatus.FINALISED) {
        throw new BadRequestException(
          'This settlement has been finalised and cannot be changed.',
        );
      }

      const line = await tx.settlementLine.create({
        data: {
          settlementId,
          kind: input.kind ?? ChargeKind.ADJUSTMENT,
          description: input.description,
          amount: toDb(input.amount),
          isManual: true,
          reason: input.reason,
          createdById: actorId,
          calcSnapshot: JSON.stringify({
            manual: true,
            by: actorId,
            at: new Date().toISOString(),
          }),
        },
      });

      await this.recalculateTotals(tx, settlementId);

      await this.audit.record({
        tx,
        actorId,
        action: 'settlement.manual_adjustment',
        entityType: 'Settlement',
        entityId: settlementId,
        after: { description: input.description, amount: input.amount },
        reason: input.reason,
      });

      return line;
    });
  }

  async removeManualLine(lineId: string, reason: string, actorId: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to remove an adjustment');
    }
    return this.prisma.runInTransaction(async (tx) => {
      const line = await tx.settlementLine.findUnique({
        where: { id: lineId },
        include: { settlement: true },
      });
      if (!line) throw new NotFoundException('Adjustment not found');
      if (!line.isManual) {
        throw new BadRequestException('Only manual adjustments can be removed');
      }
      if (line.settlement.status === SettlementStatus.FINALISED) {
        throw new BadRequestException('This settlement has been finalised');
      }

      await tx.settlementLine.delete({ where: { id: lineId } });
      await this.recalculateTotals(tx, line.settlementId);

      await this.audit.record({
        tx,
        actorId,
        action: 'settlement.remove_adjustment',
        entityType: 'Settlement',
        entityId: line.settlementId,
        before: { description: line.description, amount: money(line.amount).toFixed(2) },
        reason,
      });
      return { ok: true };
    });
  }

  /**
   * Finalises the settlement and moves the deposit: deductions are recorded
   * as an adjustment against dues, and any balance becomes a pending refund.
   */
  async finalise(settlementId: string, actorId: string) {
    return this.prisma.runInTransaction((tx) =>
      this.finaliseInTx(tx, settlementId, actorId),
    );
  }

  private async finaliseInTx(tx: Db, settlementId: string, actorId: string) {
    const settlement = await tx.settlement.findUnique({
      where: { id: settlementId },
      include: { lines: true },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status === SettlementStatus.FINALISED) {
      throw new BadRequestException('This settlement is already finalised');
    }

    const totals = await this.recalculateTotals(tx, settlementId);
    const deductions = totals.totalDeductions;
    const held = totals.depositHeld;

    // Apply the deposit against what is owed, up to what is actually held.
    const appliedAgainstDues = Decimal.min(deductions, held);
    if (appliedAgainstDues.greaterThan(0)) {
      await tx.depositEntry.create({
        data: {
          stayId: settlement.stayId,
          type: DepositEntryType.ADJUSTED_AGAINST_DUES,
          amount: toDb(appliedAgainstDues.negated()),
          occurredAt: settlement.checkoutDate,
          reason: 'Final settlement — deposit applied to outstanding charges',
          createdById: actorId,
        },
      });
    }

    const remaining = held.minus(appliedAgainstDues);
    const depositStatus = remaining.greaterThan(0)
      ? DepositStatus.REFUND_PENDING
      : DepositStatus.ADJUSTED_AGAINST_DUES;

    const updated = await tx.settlement.update({
      where: { id: settlementId },
      data: {
        status: SettlementStatus.FINALISED,
        depositStatus,
        finalisedAt: new Date(),
        finalisedById: actorId,
      },
      include: { lines: true, stay: { include: { tenant: true } } },
    });

    await this.audit.record({
      tx,
      actorId,
      action: 'settlement.finalise',
      entityType: 'Settlement',
      entityId: settlementId,
      after: {
        depositHeld: held.toFixed(2),
        totalDeductions: deductions.toFixed(2),
        netAmount: totals.netAmount.toFixed(2),
        depositStatus,
      },
    });

    return updated;
  }

  private async recalculateTotals(tx: Db, settlementId: string) {
    const settlement = await tx.settlement.findUniqueOrThrow({
      where: { id: settlementId },
      include: { lines: true },
    });
    const depositHeld = await this.payments.depositBalance(settlement.stayId, tx);
    const totalDeductions = sum(settlement.lines.map((l) => l.amount));
    const netAmount = depositHeld.minus(totalDeductions);

    await tx.settlement.update({
      where: { id: settlementId },
      data: {
        depositHeld: toDb(depositHeld),
        totalDeductions: toDb(totalDeductions),
        netAmount: toDb(netAmount),
      },
    });

    return { depositHeld, totalDeductions, netAmount };
  }

  async getByStay(stayId: string) {
    const settlement = await this.prisma.settlement.findUnique({
      where: { stayId },
      include: {
        lines: { orderBy: { createdAt: 'asc' } },
        stay: { include: { tenant: true, notice: true } },
      },
    });
    if (!settlement) throw new NotFoundException('No settlement for this stay');
    const depositLedger = await this.payments.depositLedger(stayId);
    return { ...settlement, depositLedger };
  }

  /** Deposits still owed back to former tenants. */
  async pendingRefunds() {
    const settlements = await this.prisma.settlement.findMany({
      where: {
        status: SettlementStatus.FINALISED,
        depositStatus: {
          in: [DepositStatus.REFUND_PENDING, DepositStatus.PARTIALLY_REFUNDED],
        },
      },
      orderBy: { checkoutDate: 'asc' },
      include: { stay: { include: { tenant: true } } },
    });

    const items = [];
    for (const s of settlements) {
      const held = await this.payments.depositBalance(s.stayId);
      if (held.lessThanOrEqualTo(0)) continue;
      items.push({
        settlementId: s.id,
        stayId: s.stayId,
        tenantId: s.stay.tenantId,
        tenantName: s.stay.tenant.fullName,
        mobile: s.stay.tenant.mobile,
        checkoutDate: s.checkoutDate,
        refundDue: held.toFixed(2),
        depositStatus: s.depositStatus,
      });
    }
    return { count: items.length, totalDue: sum(items.map((i) => i.refundDue)).toFixed(2), items };
  }
}
