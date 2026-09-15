import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChargeKind,
  EbCycleStatus,
  InvoiceStatus,
  StayStatus,
  StayType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import {
  addDaysTo,
  dayStart,
  inclusiveDays,
  monthEnd,
  monthStart,
  overlappingDays,
  toDateOnlyString,
} from '../../common/utils/dates';
import { money, round2, sum, toDb } from '../../common/utils/money';
import { AuditService } from '../audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { SETTING_KEYS } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import type { ChargeSegment, ComputedCharges, ComputedLine } from './billing.types';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Works out what a stay owes for a period without writing anything.
   *
   * The period is cut into segments wherever something price-relevant changed
   * — a room move, a food switch, a new rate — and each segment is priced with
   * the values in force on its own dates. That is what lets configuration
   * change today without disturbing what was billed last month.
   */
  async computeCharges(
    stayId: string,
    periodStart: Date,
    periodEnd: Date,
    db: Db = this.prisma,
    options: { includeEb?: boolean; includeCommon?: boolean } = {},
  ): Promise<ComputedCharges> {
    const start = dayStart(periodStart);
    const end = dayStart(periodEnd);
    if (end < start) {
      throw new BadRequestException('The period end cannot be before its start');
    }

    const stay = await db.stay.findUnique({
      where: { id: stayId },
      include: {
        tenant: true,
        assignments: {
          include: { bed: { include: { room: { include: { floor: true } } } } },
          orderBy: { startDate: 'asc' },
        },
        foodPeriods: { orderBy: { effectiveFrom: 'asc' } },
      },
    });
    if (!stay) throw new NotFoundException('Stay not found');

    // Clamp to the days the stay was actually live.
    const stayStart = dayStart(stay.checkInDate);
    const stayEnd = stay.actualCheckoutDate ? dayStart(stay.actualCheckoutDate) : null;
    const from = start > stayStart ? start : stayStart;
    const to = stayEnd && stayEnd < end ? stayEnd : end;

    if (to < from) {
      return { periodStart: start, periodEnd: end, lines: [], total: new Decimal(0), segments: [] };
    }

    const boundaries = this.collectBoundaries(stay, from, to);
    const segments: ChargeSegment[] = [];

    for (let i = 0; i < boundaries.length; i += 1) {
      const segStart = boundaries[i];
      const segEnd = i + 1 < boundaries.length ? addDaysTo(boundaries[i + 1], -1) : to;
      if (segEnd < segStart) continue;

      const assignment = stay.assignments.find(
        (a) =>
          dayStart(a.startDate) <= segStart &&
          (!a.endDate || dayStart(a.endDate) >= segStart),
      );
      const room = assignment?.bed.room ?? null;

      const foodPeriod = stay.foodPeriods
        .filter(
          (f) =>
            dayStart(f.effectiveFrom) <= segStart &&
            (!f.effectiveTo || dayStart(f.effectiveTo) >= segStart),
        )
        .at(-1);
      const foodIncluded =
        stay.stayType === StayType.DAILY ? false : (foodPeriod?.foodIncluded ?? false);

      const resolved = await this.pricing.resolveRent(
        {
          stayId,
          roomId: room?.id ?? null,
          branchId: room?.floor.branchId ?? null,
          capacity: room?.capacity ?? null,
          acType: room?.acType ?? null,
          variant: room?.variant ?? null,
          foodIncluded,
          on: segStart,
        },
        db,
      );

      // The configured room price is inclusive of food, so the bill splits it:
      // rent is the price minus the food component, and the food line carries
      // that component — but only when the tenant actually takes food. Adding
      // the food difference on top of the full price would charge it twice.
      const configuredFoodDifference = await this.settings.getMoneyAt(
        SETTING_KEYS.FOOD_DIFFERENCE_MONTHLY,
        segStart,
      );
      const foodDifference = Decimal.min(
        configuredFoodDifference,
        resolved.baseWithFood,
      );
      const rentComponent = resolved.baseWithFood.minus(foodDifference);

      segments.push({
        start: segStart,
        end: segEnd,
        days: inclusiveDays(segStart, segEnd),
        roomId: room?.id ?? null,
        roomName: room?.name ?? null,
        branchId: room?.floor.branchId ?? null,
        capacity: room?.capacity ?? null,
        acType: room?.acType ?? null,
        foodIncluded,
        baseWithFood: resolved.baseWithFood,
        foodDifference,
        rentComponent,
        divisorDays: await this.divisorDays(segStart),
        pricingRuleId: resolved.source.ruleId,
      });
    }

    const lines: ComputedLine[] =
      stay.stayType === StayType.DAILY
        ? await this.dailyStayLines(stay.id, segments, from, to)
        : await this.monthlyLines(segments, from, to);

    if (options.includeCommon !== false) {
      const commonLine = await this.commonChargeLine(from, to, start, end);
      if (commonLine) lines.push(commonLine);
    }

    if (options.includeEb !== false) {
      lines.push(...(await this.ebLines(stayId, start, end, db)));
    }

    return {
      periodStart: start,
      periodEnd: end,
      segments,
      lines,
      total: sum(lines.map((l) => l.amount)),
    };
  }

  /** Every date within the window on which something price-relevant changes. */
  private collectBoundaries(
    stay: {
      assignments: Array<{ startDate: Date; endDate: Date | null }>;
      foodPeriods: Array<{ effectiveFrom: Date; effectiveTo: Date | null }>;
    },
    from: Date,
    to: Date,
  ): Date[] {
    const points = new Set<number>([from.getTime()]);

    const consider = (date: Date | null | undefined) => {
      if (!date) return;
      const d = dayStart(date);
      if (d > from && d <= to) points.add(d.getTime());
    };

    for (const a of stay.assignments) {
      consider(a.startDate);
      if (a.endDate) consider(addDaysTo(a.endDate, 1));
    }
    for (const f of stay.foodPeriods) {
      consider(f.effectiveFrom);
      if (f.effectiveTo) consider(addDaysTo(f.effectiveTo, 1));
    }

    return [...points].sort((a, b) => a - b).map((t) => new Date(t));
  }

  private async divisorDays(on: Date): Promise<number> {
    const basis = await this.settings.getString(SETTING_KEYS.BILLING_PRORATION_BASIS);
    if (basis === 'FIXED_DAYS') {
      return this.settings.getInt(SETTING_KEYS.BILLING_PRORATION_FIXED_DAYS);
    }
    return inclusiveDays(monthStart(on), monthEnd(on));
  }

  /**
   * Monthly stays. Rent and food are shown as separate lines even though the
   * configured room price is a single food-inclusive number — that is what the
   * bill and the final settlement need to display.
   */
  private async monthlyLines(
    segments: ChargeSegment[],
    from: Date,
    to: Date,
  ): Promise<ComputedLine[]> {
    if (segments.length === 0) return [];
    const proration = await this.settings.getString(SETTING_KEYS.BILLING_PRORATION);
    const wholePeriod = segments.length === 1 && segments[0].days >= segments[0].divisorDays;

    const lines: ComputedLine[] = [];

    for (const segment of segments) {
      const chargeFullMonth = proration === 'FULL_MONTH' || wholePeriod;
      const rentAmount = chargeFullMonth
        ? segment.rentComponent
        : round2(segment.rentComponent.dividedBy(segment.divisorDays).times(segment.days));
      const foodAmount = !segment.foodIncluded
        ? new Decimal(0)
        : chargeFullMonth
          ? segment.foodDifference
          : round2(segment.foodDifference.dividedBy(segment.divisorDays).times(segment.days));

      const where = segment.roomName ? ` — ${segment.roomName}` : '';
      const period = `${toDateOnlyString(segment.start)} to ${toDateOnlyString(segment.end)}`;

      if (rentAmount.greaterThan(0)) {
        lines.push({
          kind: ChargeKind.RENT,
          description: chargeFullMonth
            ? `Rent${where}`
            : `Rent${where} (${segment.days} day${segment.days === 1 ? '' : 's'})`,
          quantity: chargeFullMonth ? new Decimal(1) : new Decimal(segment.days),
          unitAmount: chargeFullMonth
            ? segment.rentComponent
            : round2(segment.rentComponent.dividedBy(segment.divisorDays)),
          amount: rentAmount,
          calcSnapshot: {
            period,
            roomRateWithFood: segment.baseWithFood.toFixed(2),
            foodDifference: segment.foodDifference.toFixed(2),
            rentComponent: segment.rentComponent.toFixed(2),
            days: segment.days,
            divisorDays: segment.divisorDays,
            proration: chargeFullMonth ? 'FULL_MONTH' : 'DAILY',
            pricingRuleId: segment.pricingRuleId,
          },
        });
      }

      if (foodAmount.greaterThan(0)) {
        lines.push({
          kind: ChargeKind.FOOD,
          description: chargeFullMonth
            ? 'Food'
            : `Food (${segment.days} day${segment.days === 1 ? '' : 's'})`,
          quantity: chargeFullMonth ? new Decimal(1) : new Decimal(segment.days),
          unitAmount: chargeFullMonth
            ? segment.foodDifference
            : round2(segment.foodDifference.dividedBy(segment.divisorDays)),
          amount: foodAmount,
          calcSnapshot: {
            period,
            foodDifference: segment.foodDifference.toFixed(2),
            days: segment.days,
            divisorDays: segment.divisorDays,
          },
        });
      }
    }

    return lines;
  }

  /** Daily stays are charged per night at the daily tariff, never with food. */
  private async dailyStayLines(
    stayId: string,
    segments: ChargeSegment[],
    from: Date,
    to: Date,
  ): Promise<ComputedLine[]> {
    const days = inclusiveDays(from, to);
    if (days <= 0) return [];
    const rate = await this.pricing.resolveDailyRate({
      stayId,
      roomId: segments[0]?.roomId ?? null,
      branchId: segments[0]?.branchId ?? null,
      capacity: segments[0]?.capacity ?? null,
      acType: segments[0]?.acType ?? null,
      on: from,
    });
    const amount = round2(rate.times(days));

    return [
      {
        kind: ChargeKind.RENT,
        description: `Daily stay — ${days} day${days === 1 ? '' : 's'}`,
        quantity: new Decimal(days),
        unitAmount: rate,
        amount,
        calcSnapshot: {
          period: `${toDateOnlyString(from)} to ${toDateOnlyString(to)}`,
          dailyRate: rate.toFixed(2),
          days,
          note: 'Daily stays never include food',
        },
      },
    ];
  }

  private async commonChargeLine(
    from: Date,
    to: Date,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<ComputedLine | null> {
    const monthly = await this.settings.getMoneyAt(
      SETTING_KEYS.COMMON_CHARGE_MONTHLY,
      from,
    );
    if (monthly.lessThanOrEqualTo(0)) return null;

    const prorate = await this.settings.getBoolean(SETTING_KEYS.COMMON_CHARGE_PRORATE);
    const periodDays = inclusiveDays(periodStart, periodEnd);
    const stayedDays = inclusiveDays(from, to);
    const amount =
      prorate && stayedDays < periodDays
        ? round2(monthly.dividedBy(periodDays).times(stayedDays))
        : monthly;

    if (amount.lessThanOrEqualTo(0)) return null;

    return {
      kind: ChargeKind.COMMON,
      description:
        prorate && stayedDays < periodDays
          ? `Common charge (${stayedDays} of ${periodDays} days)`
          : 'Common charge',
      quantity: new Decimal(1),
      unitAmount: monthly,
      amount,
      calcSnapshot: {
        monthlyCommonCharge: monthly.toFixed(2),
        prorated: prorate && stayedDays < periodDays,
        stayedDays,
        periodDays,
      },
    };
  }

  /** Finalised E.B. shares for the period that haven't been billed yet. */
  private async ebLines(
    stayId: string,
    periodStart: Date,
    periodEnd: Date,
    db: Db,
  ): Promise<ComputedLine[]> {
    const charges = await db.ebCharge.findMany({
      where: {
        stayId,
        invoiceLineId: null,
        cycle: {
          status: EbCycleStatus.FINALISED,
          periodEnd: { gte: periodStart, lte: periodEnd },
        },
      },
      include: { cycle: { include: { meter: true } } },
    });

    return charges.map((charge) => ({
      kind: ChargeKind.EB,
      description: `E.B. — ${charge.cycle.meter.name} (${toDateOnlyString(
        charge.cycle.periodStart,
      )} to ${toDateOnlyString(charge.cycle.periodEnd)})`,
      quantity: money(charge.units),
      unitAmount: money(charge.cycle.ratePerUnit),
      amount: money(charge.amount),
      sourceId: charge.id,
      calcSnapshot: {
        cycleId: charge.cycleId,
        meterUnits: money(charge.cycle.unitsConsumed).toFixed(2),
        ratePerUnit: money(charge.cycle.ratePerUnit).toFixed(4),
        occupiedDays: charge.occupiedDays,
        shareRatio: money(charge.shareRatio).toFixed(6),
        tenantUnits: money(charge.units).toFixed(2),
      },
    }));
  }

  // --- Invoice lifecycle -------------------------------------------------

  /**
   * Creates (or refreshes) the draft bill for a stay and period. A bill that
   * has already been issued is never regenerated — corrections go on as
   * adjustment lines instead.
   */
  async generateInvoice(
    stayId: string,
    periodStart: Date,
    periodEnd: Date,
    actorId: string,
    options: { issue?: boolean } = {},
  ) {
    const start = dayStart(periodStart);
    const end = dayStart(periodEnd);

    return this.prisma.runInTransaction(async (tx) => {
      const existing = await tx.invoice.findUnique({
        where: {
          stayId_periodStart_periodEnd: { stayId, periodStart: start, periodEnd: end },
        },
      });
      if (existing && existing.status !== InvoiceStatus.DRAFT) {
        throw new BadRequestException(
          `A bill for this period already exists (${existing.number}) and has been issued. Add an adjustment instead of regenerating it.`,
        );
      }

      const computed = await this.computeCharges(stayId, start, end, tx);
      if (computed.lines.length === 0) {
        throw new BadRequestException('There is nothing to bill for this period');
      }

      const dueDate = await this.resolveDueDate(start, end);
      const number = existing?.number ?? (await this.nextInvoiceNumber(tx, start));

      if (existing) {
        await tx.invoiceLine.deleteMany({ where: { invoiceId: existing.id } });
        await tx.ebCharge.updateMany({
          where: { invoiceLineId: { not: null }, stayId },
          data: { invoiceLineId: null },
        });
      }

      const invoice = existing
        ? await tx.invoice.update({
            where: { id: existing.id },
            data: { totalAmount: toDb(computed.total), dueDate },
          })
        : await tx.invoice.create({
            data: {
              number,
              stayId,
              periodStart: start,
              periodEnd: end,
              dueDate,
              totalAmount: toDb(computed.total),
              createdById: actorId,
            },
          });

      for (const line of computed.lines) {
        const created = await tx.invoiceLine.create({
          data: {
            invoiceId: invoice.id,
            kind: line.kind,
            description: line.description,
            quantity: line.quantity.toFixed(3),
            unitAmount: toDb(line.unitAmount),
            amount: toDb(line.amount),
            calcSnapshot: JSON.stringify(line.calcSnapshot),
            sourceId: line.sourceId ?? null,
          },
        });
        if (line.kind === ChargeKind.EB && line.sourceId) {
          await tx.ebCharge.update({
            where: { id: line.sourceId },
            data: { invoiceLineId: created.id },
          });
        }
      }

      const final = options.issue
        ? await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: InvoiceStatus.ISSUED, issuedAt: new Date() },
          })
        : invoice;

      await this.audit.record({
        tx,
        actorId,
        action: options.issue ? 'invoice.generate_and_issue' : 'invoice.generate',
        entityType: 'Invoice',
        entityId: invoice.id,
        after: { number: final.number, total: computed.total.toFixed(2) },
      });

      return tx.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: { lines: true },
      });
    });
  }

  /** Generates this month's bills for every active stay. */
  async generateMonthlyRun(
    month: Date,
    actorId: string,
    options: { branchId?: string; issue?: boolean } = {},
  ) {
    const start = monthStart(month);
    const end = dayStart(monthEnd(month));

    const stays = await this.prisma.stay.findMany({
      where: {
        status: { in: [StayStatus.ACTIVE, StayStatus.NOTICE_GIVEN] },
        stayType: StayType.MONTHLY,
        checkInDate: { lte: end },
        ...(options.branchId
          ? {
              assignments: {
                some: {
                  bed: { room: { floor: { branchId: options.branchId } } },
                  startDate: { lte: end },
                  OR: [{ endDate: null }, { endDate: { gte: start } }],
                },
              },
            }
          : {}),
      },
      include: { tenant: { select: { fullName: true } } },
    });

    const results: Array<{
      stayId: string;
      tenant: string;
      status: 'created' | 'skipped' | 'failed';
      number?: string;
      total?: string;
      message?: string;
    }> = [];

    for (const stay of stays) {
      try {
        const invoice = await this.generateInvoice(stay.id, start, end, actorId, {
          issue: options.issue,
        });
        results.push({
          stayId: stay.id,
          tenant: stay.tenant.fullName,
          status: 'created',
          number: invoice.number,
          total: money(invoice.totalAmount).toFixed(2),
        });
      } catch (error) {
        results.push({
          stayId: stay.id,
          tenant: stay.tenant.fullName,
          status: 'skipped',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      month: toDateOnlyString(start),
      created: results.filter((r) => r.status === 'created').length,
      skipped: results.filter((r) => r.status !== 'created').length,
      results,
    };
  }

  async issueInvoice(invoiceId: string, actorId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Bill not found');
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only a draft bill can be issued');
    }
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.ISSUED, issuedAt: new Date() },
    });
    await this.audit.record({
      actorId,
      action: 'invoice.issue',
      entityType: 'Invoice',
      entityId: invoiceId,
      after: { number: updated.number },
    });
    return updated;
  }

  /**
   * Cancelling keeps the bill and its lines; it never deletes financial
   * history. A reason is mandatory.
   */
  async cancelInvoice(invoiceId: string, reason: string, actorId: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to cancel a bill');
    }
    return this.prisma.runInTransaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { allocations: true },
      });
      if (!invoice) throw new NotFoundException('Bill not found');
      if (invoice.allocations.length > 0) {
        throw new BadRequestException(
          'Payments are applied to this bill. Reverse those payments before cancelling it.',
        );
      }
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: InvoiceStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: reason,
        },
      });
      // Release any E.B. shares so they can be billed again later.
      await tx.ebCharge.updateMany({
        where: { invoiceLineId: { in: [] } },
        data: { invoiceLineId: null },
      });
      await this.audit.record({
        tx,
        actorId,
        action: 'invoice.cancel',
        entityType: 'Invoice',
        entityId: invoiceId,
        before: { status: invoice.status },
        after: { status: InvoiceStatus.CANCELLED },
        reason,
      });
      return updated;
    });
  }

  /**
   * Adds a manual charge or credit to an issued bill. Reason and user are
   * mandatory — historical amounts are never quietly edited.
   */
  async addAdjustment(
    invoiceId: string,
    input: { description: string; amount: string; reason: string },
    actorId: string,
  ) {
    if (!input.reason?.trim()) {
      throw new BadRequestException('A reason is required for a manual adjustment');
    }
    return this.prisma.runInTransaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new NotFoundException('Bill not found');
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException('This bill has been cancelled');
      }

      const amount = money(input.amount);
      const line = await tx.invoiceLine.create({
        data: {
          invoiceId,
          kind: ChargeKind.ADJUSTMENT,
          description: input.description,
          quantity: '1',
          unitAmount: toDb(amount),
          amount: toDb(amount),
          calcSnapshot: JSON.stringify({
            manual: true,
            reason: input.reason,
            by: actorId,
            at: new Date().toISOString(),
          }),
        },
      });

      const total = money(invoice.totalAmount).plus(amount);
      const paid = money(invoice.paidAmount);
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          totalAmount: toDb(total),
          status: this.deriveStatus(invoice.status, total, paid),
        },
      });

      await this.audit.record({
        tx,
        actorId,
        action: 'invoice.adjustment',
        entityType: 'Invoice',
        entityId: invoiceId,
        after: { description: input.description, amount: amount.toFixed(2) },
        reason: input.reason,
      });

      return line;
    });
  }

  private deriveStatus(
    current: InvoiceStatus,
    total: Decimal,
    paid: Decimal,
  ): InvoiceStatus {
    if (current === InvoiceStatus.DRAFT || current === InvoiceStatus.CANCELLED) {
      return current;
    }
    if (paid.greaterThanOrEqualTo(total) && total.greaterThan(0)) {
      return InvoiceStatus.PAID;
    }
    if (paid.greaterThan(0)) return InvoiceStatus.PARTIALLY_PAID;
    return InvoiceStatus.ISSUED;
  }

  private async resolveDueDate(periodStart: Date, periodEnd: Date): Promise<Date> {
    const dueDay = await this.settings.getInt(SETTING_KEYS.BILLING_DUE_DAY);
    const candidate = new Date(
      periodStart.getFullYear(),
      periodStart.getMonth(),
      Math.min(dueDay, inclusiveDays(monthStart(periodStart), monthEnd(periodStart))),
    );
    return candidate < periodStart ? dayStart(periodStart) : dayStart(candidate);
  }

  private async nextInvoiceNumber(tx: Db, periodStart: Date): Promise<string> {
    const prefix = await this.settings.rawInTx(tx, SETTING_KEYS.INVOICE_PREFIX);
    const stamp = `${periodStart.getFullYear()}${String(periodStart.getMonth() + 1).padStart(2, '0')}`;
    const count = await tx.invoice.count({
      where: { number: { startsWith: `${prefix}-${stamp}-` } },
    });
    return `${prefix}-${stamp}-${String(count + 1).padStart(4, '0')}`;
  }

  // --- Queries -----------------------------------------------------------

  async listInvoices(filter: {
    stayId?: string;
    tenantId?: string;
    branchId?: string;
    status?: InvoiceStatus[];
    overdueOnly?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 25, 200);
    const today = dayStart(new Date());

    const where = {
      stayId: filter.stayId,
      status: filter.status ? { in: filter.status } : undefined,
      dueDate: filter.overdueOnly ? { lt: today } : undefined,
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
      this.prisma.invoice.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }, { number: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          lines: true,
          stay: { include: { tenant: { select: { id: true, fullName: true, mobile: true } } } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      items: items.map((i) => ({
        ...i,
        balance: money(i.totalAmount).minus(money(i.paidAmount)).toFixed(2),
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getInvoice(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { createdAt: 'asc' } },
        allocations: { include: { payment: true } },
        stay: {
          include: {
            tenant: true,
            assignments: {
              orderBy: { startDate: 'desc' },
              take: 1,
              include: {
                bed: { include: { room: { include: { floor: { include: { branch: true } } } } } },
              },
            },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Bill not found');
    return {
      ...invoice,
      balance: money(invoice.totalAmount).minus(money(invoice.paidAmount)).toFixed(2),
    };
  }

  /** Outstanding money for a stay, used by settlement and the tenant screen. */
  async outstandingForStay(stayId: string, db: Db = this.prisma) {
    const invoices = await db.invoice.findMany({
      where: {
        stayId,
        status: {
          in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID],
        },
      },
      include: { lines: true },
      orderBy: { periodStart: 'asc' },
    });

    const totalBilled = sum(invoices.map((i) => i.totalAmount));
    const totalPaid = sum(invoices.map((i) => i.paidAmount));
    const balance = totalBilled.minus(totalPaid);

    const byKind = new Map<ChargeKind, Decimal>();
    for (const invoice of invoices) {
      for (const line of invoice.lines) {
        byKind.set(
          line.kind,
          (byKind.get(line.kind) ?? new Decimal(0)).plus(money(line.amount)),
        );
      }
    }

    return {
      invoices,
      totalBilled,
      totalPaid,
      balance,
      byKind: Object.fromEntries(
        [...byKind.entries()].map(([k, v]) => [k, v.toFixed(2)]),
      ),
      unpaid: invoices.filter((i) =>
        money(i.totalAmount).greaterThan(money(i.paidAmount)),
      ),
    };
  }

  /** Payments screen: everyone with money outstanding right now. */
  async pendingPayments(branchId?: string, branchScope: string[] = []) {
    const today = dayStart(new Date());
    const graceDays = await this.settings.getInt(SETTING_KEYS.NOTIFY_PAYMENT_GRACE_DAYS);
    const cutoff = addDaysTo(today, -graceDays);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
        dueDate: { lte: cutoff },
        stay: branchId || branchScope.length
          ? {
              assignments: {
                some: {
                  endDate: null,
                  bed: {
                    room: {
                      floor: {
                        branchId: branchId ? branchId : { in: branchScope },
                      },
                    },
                  },
                },
              },
            }
          : undefined,
      },
      orderBy: { dueDate: 'asc' },
      include: {
        stay: {
          include: {
            tenant: { select: { id: true, fullName: true, mobile: true } },
            assignments: {
              where: { endDate: null },
              take: 1,
              include: {
                bed: { include: { room: { include: { floor: { include: { branch: true } } } } } },
              },
            },
          },
        },
      },
    });

    const byStay = new Map<
      string,
      {
        stayId: string;
        tenantId: string;
        tenantName: string;
        mobile: string | null;
        branchName: string | null;
        roomName: string | null;
        bedLabel: string | null;
        balance: Decimal;
        oldestDueDate: Date;
        invoiceCount: number;
        daysOverdue: number;
      }
    >();

    for (const invoice of invoices) {
      const balance = money(invoice.totalAmount).minus(money(invoice.paidAmount));
      if (balance.lessThanOrEqualTo(0)) continue;
      const assignment = invoice.stay.assignments[0];
      const existing = byStay.get(invoice.stayId);
      if (existing) {
        existing.balance = existing.balance.plus(balance);
        existing.invoiceCount += 1;
        if (invoice.dueDate < existing.oldestDueDate) {
          existing.oldestDueDate = invoice.dueDate;
          existing.daysOverdue = inclusiveDays(invoice.dueDate, today) - 1;
        }
      } else {
        byStay.set(invoice.stayId, {
          stayId: invoice.stayId,
          tenantId: invoice.stay.tenantId,
          tenantName: invoice.stay.tenant.fullName,
          mobile: invoice.stay.tenant.mobile,
          branchName: assignment?.bed.room.floor.branch.name ?? null,
          roomName: assignment?.bed.room.name ?? null,
          bedLabel: assignment?.bed.label ?? null,
          balance,
          oldestDueDate: invoice.dueDate,
          invoiceCount: 1,
          daysOverdue: inclusiveDays(invoice.dueDate, today) - 1,
        });
      }
    }

    const items = [...byStay.values()]
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .map((i) => ({ ...i, balance: i.balance.toFixed(2) }));

    return {
      totalOutstanding: sum([...byStay.values()].map((i) => i.balance)).toFixed(2),
      count: items.length,
      items,
    };
  }
}
