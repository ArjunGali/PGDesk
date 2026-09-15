import { Injectable } from '@nestjs/common';
import {
  BranchStatus,
  InvoiceStatus,
  PaymentStatus,
  StayStatus,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  dayStart,
  inclusiveDays,
  monthEnd,
  monthStart,
  overlappingDays,
  toDateOnlyString,
} from '../../common/utils/dates';
import { money, round2, sum } from '../../common/utils/money';
import { PropertyService } from '../property/property.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly property: PropertyService,
  ) {}

  /** Money in, money out and what is still owed for a period. */
  async collections(from: Date, to: Date, branchId?: string) {
    const start = dayStart(from);
    const end = dayStart(to);

    const branchFilter = branchId
      ? {
          assignments: {
            some: { bed: { room: { floor: { branchId } } } },
          },
        }
      : undefined;

    const [payments, invoices, expenses] = await Promise.all([
      this.prisma.payment.findMany({
        // Only approved money is income. Anything still awaiting approval has
        // not reached the ledger and must not inflate a collections figure.
        where: {
          paidAt: { gte: start, lte: end },
          stay: branchFilter,
          status: PaymentStatus.VERIFIED,
        },
        include: { stay: { include: { tenant: { select: { fullName: true } } } } },
      }),
      this.prisma.invoice.findMany({
        where: {
          periodStart: { gte: start, lte: end },
          status: { not: InvoiceStatus.CANCELLED },
          stay: branchFilter,
        },
        include: { lines: true },
      }),
      this.prisma.expense.findMany({
        where: { spentAt: { gte: start, lte: end }, branchId },
      }),
    ]);

    const collected = sum(payments.map((p) => p.amount));
    const billed = sum(invoices.map((i) => i.totalAmount));
    const spent = sum(expenses.map((e) => e.amount));

    const byKind = new Map<string, Decimal>();
    for (const invoice of invoices) {
      for (const line of invoice.lines) {
        byKind.set(
          line.kind,
          (byKind.get(line.kind) ?? new Decimal(0)).plus(money(line.amount)),
        );
      }
    }

    const byMethod = new Map<string, Decimal>();
    for (const payment of payments) {
      byMethod.set(
        payment.method,
        (byMethod.get(payment.method) ?? new Decimal(0)).plus(money(payment.amount)),
      );
    }

    return {
      from: start,
      to: end,
      billed: billed.toFixed(2),
      collected: collected.toFixed(2),
      outstanding: billed.minus(collected).toFixed(2),
      expenses: spent.toFixed(2),
      net: collected.minus(spent).toFixed(2),
      paymentCount: payments.length,
      invoiceCount: invoices.length,
      billedByKind: Object.fromEntries(
        [...byKind.entries()].map(([k, v]) => [k, v.toFixed(2)]),
      ),
      collectedByMethod: Object.fromEntries(
        [...byMethod.entries()].map(([k, v]) => [k, v.toFixed(2)]),
      ),
    };
  }

  /**
   * Income, expenses and profit for a period.
   *
   * Income is money actually collected and approved, split by what it was
   * charged for, so "rent" and "electricity" can be read separately. Profit is
   * simply income minus expenses — the number the owner is actually after.
   */
  async profitAndLoss(from: Date, to: Date, branchId?: string) {
    const start = dayStart(from);
    const end = dayStart(to);

    const branchFilter = branchId
      ? { assignments: { some: { bed: { room: { floor: { branchId } } } } } }
      : undefined;

    const [payments, expenses] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          paidAt: { gte: start, lte: end },
          status: PaymentStatus.VERIFIED,
          stay: branchFilter,
        },
        include: {
          allocations: { include: { invoice: { include: { lines: true } } } },
        },
      }),
      this.prisma.expense.findMany({
        where: { spentAt: { gte: start, lte: end }, branchId },
        include: { category: true },
      }),
    ]);

    // Attribute each rupee collected to what it paid for, in the same
    // proportions as the bill it was applied to. Money that arrived as an
    // unallocated advance is reported separately rather than guessed at.
    const incomeByKind = new Map<string, Decimal>();
    let unattributed = new Decimal(0);

    for (const payment of payments) {
      const paymentAmount = money(payment.amount);
      const allocatedTotal = sum(payment.allocations.map((a) => a.amount));
      unattributed = unattributed.plus(paymentAmount.minus(allocatedTotal));

      for (const allocation of payment.allocations) {
        const invoiceTotal = sum(allocation.invoice.lines.map((l) => l.amount));
        if (invoiceTotal.lessThanOrEqualTo(0)) continue;

        const applied = money(allocation.amount);
        for (const line of allocation.invoice.lines) {
          const share = applied.times(money(line.amount)).dividedBy(invoiceTotal);
          incomeByKind.set(
            line.kind,
            (incomeByKind.get(line.kind) ?? new Decimal(0)).plus(share),
          );
        }
      }
    }

    const totalIncome = sum(payments.map((p) => p.amount));
    const totalExpenses = sum(expenses.map((e) => e.amount));

    const expensesByCategory = new Map<string, Decimal>();
    for (const expense of expenses) {
      const key = expense.category?.name ?? 'Uncategorised';
      expensesByCategory.set(
        key,
        (expensesByCategory.get(key) ?? new Decimal(0)).plus(money(expense.amount)),
      );
    }

    return {
      from: start,
      to: end,
      income: {
        total: totalIncome.toFixed(2),
        byKind: Object.fromEntries(
          [...incomeByKind.entries()].map(([k, v]) => [k, round2(v).toFixed(2)]),
        ),
        unattributed: round2(unattributed).toFixed(2),
        paymentCount: payments.length,
      },
      expenses: {
        total: totalExpenses.toFixed(2),
        byCategory: [...expensesByCategory.entries()]
          .map(([name, total]) => ({ name, total: total.toFixed(2) }))
          .sort((a, b) => Number(b.total) - Number(a.total)),
        count: expenses.length,
      },
      profit: totalIncome.minus(totalExpenses).toFixed(2),
    };
  }

  /**
   * Average bed occupancy over a period, per branch. Computed from assignment
   * history rather than a current snapshot, so it stays correct for the past.
   */
  async occupancy(from: Date, to: Date, branchScope: string[] = []) {
    const start = dayStart(from);
    const end = dayStart(to);
    const periodDays = inclusiveDays(start, end);

    const branches = await this.prisma.branch.findMany({
      where: {
        status: { in: [BranchStatus.ACTIVE, BranchStatus.DISABLED] },
        id: branchScope.length ? { in: branchScope } : undefined,
      },
      include: {
        floors: {
          where: { isActive: true },
          include: {
            rooms: {
              where: { isActive: true },
              include: { beds: { where: { isActive: true } } },
            },
          },
        },
      },
    });

    const results = [];
    for (const branch of branches) {
      const bedIds = branch.floors.flatMap((f) =>
        f.rooms.flatMap((r) => r.beds.map((b) => b.id)),
      );
      if (bedIds.length === 0) continue;

      const assignments = await this.prisma.bedAssignment.findMany({
        where: {
          bedId: { in: bedIds },
          startDate: { lte: end },
          OR: [{ endDate: null }, { endDate: { gte: start } }],
          stay: { status: { not: StayStatus.CANCELLED } },
        },
      });

      const occupiedBedDays = assignments.reduce(
        (total, a) =>
          total +
          overlappingDays({ start: a.startDate, end: a.endDate }, { start, end }),
        0,
      );
      const availableBedDays = bedIds.length * periodDays;

      results.push({
        branchId: branch.id,
        branchName: branch.name,
        totalBeds: bedIds.length,
        periodDays,
        occupiedBedDays,
        availableBedDays,
        occupancyRate: round2(
          new Decimal(occupiedBedDays).dividedBy(availableBedDays).times(100),
        ).toFixed(2),
      });
    }

    return { from: start, to: end, periodDays, branches: results };
  }

  /** Tenants who moved in or out during the period. */
  async movements(from: Date, to: Date, branchId?: string) {
    const start = dayStart(from);
    const end = dayStart(to);

    const [moveIns, moveOuts] = await Promise.all([
      this.prisma.stay.findMany({
        where: {
          checkInDate: { gte: start, lte: end },
          ...(branchId
            ? {
                assignments: {
                  some: { bed: { room: { floor: { branchId } } } },
                },
              }
            : {}),
        },
        include: {
          tenant: { select: { id: true, fullName: true, mobile: true } },
          assignments: {
            orderBy: { startDate: 'asc' },
            take: 1,
            include: { bed: { include: { room: { include: { floor: { include: { branch: true } } } } } } },
          },
        },
      }),
      this.prisma.stay.findMany({
        where: {
          actualCheckoutDate: { gte: start, lte: end },
          ...(branchId
            ? {
                assignments: {
                  some: { bed: { room: { floor: { branchId } } } },
                },
              }
            : {}),
        },
        include: {
          tenant: { select: { id: true, fullName: true, mobile: true } },
          settlement: true,
          assignments: {
            orderBy: { startDate: 'desc' },
            take: 1,
            include: { bed: { include: { room: { include: { floor: { include: { branch: true } } } } } } },
          },
        },
      }),
    ]);

    return {
      from: start,
      to: end,
      moveInCount: moveIns.length,
      moveOutCount: moveOuts.length,
      netChange: moveIns.length - moveOuts.length,
      moveIns: moveIns.map((s) => ({
        stayId: s.id,
        tenantId: s.tenantId,
        tenantName: s.tenant.fullName,
        date: s.checkInDate,
        room: s.assignments[0]?.bed.room.name ?? null,
        branch: s.assignments[0]?.bed.room.floor.branch.name ?? null,
      })),
      moveOuts: moveOuts.map((s) => ({
        stayId: s.id,
        tenantId: s.tenantId,
        tenantName: s.tenant.fullName,
        date: s.actualCheckoutDate,
        room: s.assignments[0]?.bed.room.name ?? null,
        branch: s.assignments[0]?.bed.room.floor.branch.name ?? null,
        settlementNet: s.settlement ? money(s.settlement.netAmount).toFixed(2) : null,
      })),
    };
  }

  /** Electricity consumption and billing by meter for a period. */
  async ebSummary(from: Date, to: Date, branchId?: string) {
    const cycles = await this.prisma.ebCycle.findMany({
      where: {
        periodEnd: { gte: dayStart(from), lte: dayStart(to) },
        status: 'FINALISED',
        meter: branchId ? { room: { floor: { branchId } } } : undefined,
      },
      include: {
        meter: { include: { room: { include: { floor: { include: { branch: true } } } } } },
        charges: true,
      },
      orderBy: { periodEnd: 'desc' },
    });

    return {
      from,
      to,
      totalUnits: sum(cycles.map((c) => c.unitsConsumed)).toFixed(2),
      totalAmount: sum(cycles.map((c) => c.totalAmount)).toFixed(2),
      cycleCount: cycles.length,
      cycles: cycles.map((c) => ({
        id: c.id,
        meterName: c.meter.name,
        roomName: c.meter.room?.name ?? null,
        branchName: c.meter.room?.floor.branch.name ?? null,
        periodStart: c.periodStart,
        periodEnd: c.periodEnd,
        units: money(c.unitsConsumed).toFixed(2),
        ratePerUnit: money(c.ratePerUnit).toFixed(2),
        amount: money(c.totalAmount).toFixed(2),
        tenantCount: c.charges.length,
      })),
    };
  }

  /** A month at a glance — the default Reports view. */
  async monthlySummary(month: Date, branchId?: string, branchScope: string[] = []) {
    const start = monthStart(month);
    const end = dayStart(monthEnd(month));

    const [collections, profitAndLoss, occupancy, movements, eb, summaries] =
      await Promise.all([
      this.collections(start, end, branchId),
      this.profitAndLoss(start, end, branchId),
      this.occupancy(start, end, branchId ? [branchId] : branchScope),
      this.movements(start, end, branchId),
      this.ebSummary(start, end, branchId),
      this.property.branchSummaries(end, 30, branchId ? [branchId] : branchScope),
    ]);

    return {
      month: toDateOnlyString(start),
      periodStart: start,
      periodEnd: end,
      collections,
      profitAndLoss,
      occupancy,
      movements,
      eb,
      branches: summaries,
    };
  }
}
