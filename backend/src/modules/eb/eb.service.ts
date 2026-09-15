import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EbCycleStatus, StayStatus } from '@prisma/client';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import {
  dayStart,
  inclusiveDays,
  overlappingDays,
} from '../../common/utils/dates';
import { money, toDb } from '../../common/utils/money';
import { AuditService } from '../audit/audit.service';
import { SETTING_KEYS } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import {
  computeEbCycle,
  EbCalculationError,
  type EbSplitMethod,
} from './eb.algorithm';

@Injectable()
export class EbService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // --- Meters ------------------------------------------------------------

  listMeters(branchId?: string) {
    return this.prisma.ebMeter.findMany({
      where: {
        isActive: true,
        room: branchId ? { floor: { branchId } } : undefined,
      },
      orderBy: { name: 'asc' },
      include: {
        room: { include: { floor: { include: { branch: true } } } },
        readings: { orderBy: { readingDate: 'desc' }, take: 1 },
      },
    });
  }

  createMeter(input: { roomId?: string; name: string; serialNo?: string }) {
    return this.prisma.ebMeter.create({ data: input });
  }

  async recordReading(
    input: {
      meterId: string;
      readingDate: string;
      value: string;
      isReset?: boolean;
      notes?: string;
      photoPath?: string;
    },
    actorId: string,
  ) {
    const readingDate = dayStart(input.readingDate);
    const previous = await this.prisma.ebReading.findFirst({
      where: { meterId: input.meterId, readingDate: { lt: readingDate } },
      orderBy: { readingDate: 'desc' },
    });

    if (previous && !input.isReset && money(input.value).lessThan(money(previous.value))) {
      throw new BadRequestException(
        `That reading (${input.value}) is lower than the previous one (${money(
          previous.value,
        ).toFixed(2)} on ${previous.readingDate.toDateString()}). Check the value, or mark it as a meter reset.`,
      );
    }

    const reading = await this.prisma.ebReading.create({
      data: {
        meterId: input.meterId,
        readingDate,
        value: toDb(input.value),
        isReset: input.isReset ?? false,
        notes: input.notes,
        photoPath: input.photoPath,
        recordedById: actorId,
      },
    });

    await this.audit.record({
      actorId,
      action: 'eb.reading_record',
      entityType: 'EbReading',
      entityId: reading.id,
      after: input,
    });
    return reading;
  }

  listReadings(meterId: string, take = 24) {
    return this.prisma.ebReading.findMany({
      where: { meterId },
      orderBy: { readingDate: 'desc' },
      take,
    });
  }

  // --- Cycles ------------------------------------------------------------

  /**
   * Works out a cycle without saving it — this is what the E.B. Calculations
   * screen shows before the owner commits.
   */
  async previewCycle(input: {
    meterId: string;
    periodStart: string | Date;
    periodEnd: string | Date;
    /** Optional manual override when a reading was not recorded on the day. */
    startValue?: string;
    endValue?: string;
  }) {
    const periodStart = dayStart(input.periodStart);
    const periodEnd = dayStart(input.periodEnd);
    if (periodEnd < periodStart) {
      throw new BadRequestException('The period end cannot be before its start');
    }

    const meter = await this.prisma.ebMeter.findUnique({
      where: { id: input.meterId },
      include: { room: { include: { floor: { include: { branch: true } } } } },
    });
    if (!meter) throw new NotFoundException('Meter not found');

    const startReading = input.startValue
      ? null
      : await this.prisma.ebReading.findFirst({
          where: { meterId: meter.id, readingDate: { lte: periodStart } },
          orderBy: { readingDate: 'desc' },
        });

    const endReading = input.endValue
      ? null
      : await this.prisma.ebReading.findFirst({
          where: {
            meterId: meter.id,
            readingDate: { gte: periodStart, lte: periodEnd },
          },
          orderBy: { readingDate: 'desc' },
        });

    if (!input.endValue && !endReading) {
      throw new BadRequestException(
        'No closing reading has been recorded for this period. Record the meter reading first.',
      );
    }

    const occupants = await this.occupantsOf(meter.roomId, periodStart, periodEnd);

    const [rate, splitMethod, maxUnits] = await Promise.all([
      this.settings.getMoneyAt(SETTING_KEYS.EB_RATE_PER_UNIT, periodEnd),
      this.settings.getString(SETTING_KEYS.EB_SPLIT_METHOD),
      this.settings.getNumber(SETTING_KEYS.EB_MAX_PLAUSIBLE_UNITS),
    ]);

    try {
      const result = computeEbCycle({
        startReading: input.startValue ?? startReading?.value ?? null,
        endReading: input.endValue ?? endReading!.value,
        endIsReset: endReading?.isReset ?? false,
        ratePerUnit: rate,
        periodDays: inclusiveDays(periodStart, periodEnd),
        maxPlausibleUnitsPerDay: maxUnits,
        splitMethod: splitMethod as EbSplitMethod,
        // ROOM_CAPACITY needs the sharing size to know what one bed's share is.
        roomCapacity: meter.room?.capacity ?? null,
        occupants: occupants.map((o) => ({
          stayId: o.stayId,
          occupiedDays: o.occupiedDays,
        })),
      });

      const namesByStay = new Map(occupants.map((o) => [o.stayId, o]));

      return {
        meter: {
          id: meter.id,
          name: meter.name,
          roomName: meter.room?.name ?? null,
          roomCapacity: meter.room?.capacity ?? null,
          branchName: meter.room?.floor.branch.name ?? null,
        },
        periodStart,
        periodEnd,
        periodDays: inclusiveDays(periodStart, periodEnd),
        startReading: startReading
          ? { id: startReading.id, value: money(startReading.value).toFixed(2), date: startReading.readingDate }
          : input.startValue
            ? { id: null, value: money(input.startValue).toFixed(2), date: periodStart }
            : null,
        endReading: endReading
          ? { id: endReading.id, value: money(endReading.value).toFixed(2), date: endReading.readingDate }
          : { id: null, value: money(input.endValue!).toFixed(2), date: periodEnd },
        unitsConsumed: result.unitsConsumed.toFixed(2),
        ratePerUnit: result.ratePerUnit.toFixed(2),
        totalAmount: result.totalAmount.toFixed(2),
        splitMethod,
        warnings: result.warnings,
        unallocatedAmount: result.unallocatedAmount.toFixed(2),
        shares: result.shares.map((s) => ({
          stayId: s.stayId,
          tenantId: namesByStay.get(s.stayId)?.tenantId ?? null,
          tenantName: namesByStay.get(s.stayId)?.tenantName ?? 'Unknown',
          bedLabel: namesByStay.get(s.stayId)?.bedLabel ?? null,
          occupiedDays: s.occupiedDays,
          shareRatio: s.shareRatio.toFixed(6),
          units: s.units.toFixed(2),
          amount: s.amount.toFixed(2),
        })),
      };
    } catch (error) {
      if (error instanceof EbCalculationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * Saves and finalises a cycle. The rate is copied onto the cycle at this
   * moment; a later rate change can never alter it.
   */
  async finaliseCycle(
    input: {
      meterId: string;
      periodStart: string;
      periodEnd: string;
      startValue?: string;
      endValue?: string;
      notes?: string;
      /** Required when the preview raised warnings. */
      acknowledgeWarnings?: boolean;
    },
    actorId: string,
  ) {
    const preview = await this.previewCycle(input);
    if (preview.warnings.length > 0 && !input.acknowledgeWarnings) {
      throw new BadRequestException(
        `Please review before finalising: ${preview.warnings.join(' ')}`,
      );
    }

    const periodStart = dayStart(input.periodStart);
    const periodEnd = dayStart(input.periodEnd);

    return this.prisma.runInTransaction(async (tx) => {
      const existing = await tx.ebCycle.findUnique({
        where: {
          meterId_periodStart_periodEnd: {
            meterId: input.meterId,
            periodStart,
            periodEnd,
          },
        },
      });
      if (existing && existing.status === EbCycleStatus.FINALISED) {
        throw new BadRequestException(
          'This meter period has already been finalised. Cancel it first if it needs to be redone.',
        );
      }

      const data = {
        meterId: input.meterId,
        periodStart,
        periodEnd,
        startReadingId: preview.startReading?.id ?? null,
        endReadingId: preview.endReading?.id ?? null,
        unitsConsumed: toDb(preview.unitsConsumed),
        ratePerUnit: preview.ratePerUnit,
        totalAmount: toDb(preview.totalAmount),
        status: EbCycleStatus.FINALISED,
        calcSnapshot: JSON.stringify({
          ...preview,
          finalisedBy: actorId,
          finalisedAt: new Date().toISOString(),
        }),
        notes: input.notes,
        finalisedAt: new Date(),
        createdById: actorId,
      };

      const cycle = existing
        ? await tx.ebCycle.update({ where: { id: existing.id }, data })
        : await tx.ebCycle.create({ data });

      await tx.ebCharge.deleteMany({
        where: { cycleId: cycle.id, invoiceLineId: null },
      });

      for (const share of preview.shares) {
        await tx.ebCharge.create({
          data: {
            cycleId: cycle.id,
            stayId: share.stayId,
            occupiedDays: share.occupiedDays,
            shareRatio: share.shareRatio,
            units: toDb(share.units),
            amount: toDb(share.amount),
          },
        });
      }

      await this.audit.record({
        tx,
        actorId,
        action: 'eb.cycle_finalise',
        entityType: 'EbCycle',
        entityId: cycle.id,
        after: {
          units: preview.unitsConsumed,
          rate: preview.ratePerUnit,
          total: preview.totalAmount,
          shares: preview.shares.length,
        },
      });

      return tx.ebCycle.findUniqueOrThrow({
        where: { id: cycle.id },
        include: { charges: true, meter: true },
      });
    });
  }

  async cancelCycle(cycleId: string, reason: string, actorId: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to cancel an E.B. cycle');
    }
    return this.prisma.runInTransaction(async (tx) => {
      const cycle = await tx.ebCycle.findUnique({
        where: { id: cycleId },
        include: { charges: true },
      });
      if (!cycle) throw new NotFoundException('E.B. cycle not found');

      const billed = cycle.charges.filter((c) => c.invoiceLineId);
      if (billed.length > 0) {
        throw new BadRequestException(
          `${billed.length} of these charges are already on a bill. Cancel or adjust those bills first.`,
        );
      }

      await tx.ebCharge.deleteMany({ where: { cycleId } });
      const updated = await tx.ebCycle.update({
        where: { id: cycleId },
        data: { status: EbCycleStatus.CANCELLED, notes: reason },
      });

      await this.audit.record({
        tx,
        actorId,
        action: 'eb.cycle_cancel',
        entityType: 'EbCycle',
        entityId: cycleId,
        reason,
      });
      return updated;
    });
  }

  listCycles(filter: { meterId?: string; branchId?: string; from?: Date; to?: Date }) {
    return this.prisma.ebCycle.findMany({
      where: {
        meterId: filter.meterId,
        periodEnd: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
        meter: filter.branchId ? { room: { floor: { branchId: filter.branchId } } } : undefined,
      },
      orderBy: { periodEnd: 'desc' },
      include: {
        meter: { include: { room: { include: { floor: { include: { branch: true } } } } } },
        charges: { include: { stay: { include: { tenant: { select: { fullName: true } } } } } },
      },
    });
  }

  /**
   * Which stays occupied a bed in the metered room during the period, and for
   * how many days. This is what makes the split fair when tenants come and go
   * mid-cycle.
   */
  private async occupantsOf(
    roomId: string | null,
    periodStart: Date,
    periodEnd: Date,
    db: Db = this.prisma,
  ) {
    if (!roomId) return [];

    const assignments = await db.bedAssignment.findMany({
      where: {
        bed: { roomId },
        startDate: { lte: periodEnd },
        OR: [{ endDate: null }, { endDate: { gte: periodStart } }],
        stay: { status: { not: StayStatus.CANCELLED } },
      },
      include: {
        bed: true,
        stay: { include: { tenant: { select: { id: true, fullName: true } } } },
      },
    });

    const byStay = new Map<
      string,
      {
        stayId: string;
        tenantId: string;
        tenantName: string;
        bedLabel: string;
        occupiedDays: number;
      }
    >();

    for (const assignment of assignments) {
      const days = overlappingDays(
        { start: assignment.startDate, end: assignment.endDate },
        { start: periodStart, end: periodEnd },
      );
      if (days <= 0) continue;

      const existing = byStay.get(assignment.stayId);
      if (existing) {
        existing.occupiedDays += days;
      } else {
        byStay.set(assignment.stayId, {
          stayId: assignment.stayId,
          tenantId: assignment.stay.tenantId,
          tenantName: assignment.stay.tenant.fullName,
          bedLabel: assignment.bed.label,
          occupiedDays: days,
        });
      }
    }

    return [...byStay.values()];
  }
}
