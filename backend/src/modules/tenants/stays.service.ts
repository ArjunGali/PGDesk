import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentEndReason,
  DepositEntryType,
  PricingScope,
  StayStatus,
  StayType,
} from '@prisma/client';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { addDaysTo, dayStart, inclusiveDays } from '../../common/utils/dates';
import { money, toDb } from '../../common/utils/money';
import { AuditService } from '../audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { SETTING_KEYS } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import type {
  AssignBedDto,
  ChangeFoodDto,
  CreateStayDto,
  GiveNoticeDto,
  SetCustomRentDto,
  SwitchRoomDto,
} from './dto';

@Injectable()
export class StaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Starts a new stay for a tenant. A tenant may have many stays over time;
   * previous ones are never touched.
   */
  async createStay(tenantId: string, dto: CreateStayDto, actorId: string) {
    const checkIn = dayStart(dto.checkInDate);
    const stayType = dto.stayType ?? StayType.MONTHLY;

    if (stayType === StayType.DAILY && dto.foodIncluded) {
      throw new BadRequestException('Daily stays cannot include food');
    }

    return this.prisma.runInTransaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('Tenant not found');

      const open = await tx.stay.findFirst({
        where: {
          tenantId,
          status: { in: [StayStatus.ACTIVE, StayStatus.NOTICE_GIVEN] },
        },
      });
      if (open) {
        throw new BadRequestException(
          'This tenant already has an open stay. Vacate it before starting a new one.',
        );
      }

      let expectedCheckout = dto.expectedCheckoutDate
        ? dayStart(dto.expectedCheckoutDate)
        : null;
      if (stayType === StayType.DAILY && dto.plannedDays && !expectedCheckout) {
        expectedCheckout = addDaysTo(checkIn, dto.plannedDays - 1);
      }

      const stay = await tx.stay.create({
        data: {
          tenantId,
          stayType,
          checkInDate: checkIn,
          expectedCheckoutDate: expectedCheckout,
          plannedDays: dto.plannedDays ?? null,
          depositAmount: toDb(dto.depositAmount ?? 0),
          notes: dto.notes,
        },
      });

      // Food status is effective-dated from day one so later changes layer on
      // top instead of rewriting what was true before.
      await tx.foodPeriod.create({
        data: {
          stayId: stay.id,
          foodIncluded: stayType === StayType.DAILY ? false : (dto.foodIncluded ?? false),
          effectiveFrom: checkIn,
          reason: 'Initial food status at check-in',
          changedById: actorId,
        },
      });

      if (dto.bedId) {
        await this.assignBedInTx(tx, stay.id, dto.bedId, checkIn, 'Check-in', actorId);
      }

      if (dto.customRent) {
        await tx.pricingRule.create({
          data: {
            scope: PricingScope.STAY,
            stayId: stay.id,
            amountWithFood: toDb(dto.customRent),
            effectiveFrom: checkIn,
            reason: dto.customRentReason ?? 'Tenant-specific rent agreed at check-in',
            createdById: actorId,
          },
        });
      }

      if (dto.depositCollected && money(dto.depositCollected).greaterThan(0)) {
        await tx.depositEntry.create({
          data: {
            stayId: stay.id,
            type: DepositEntryType.COLLECTED,
            amount: toDb(dto.depositCollected),
            occurredAt: checkIn,
            reason: 'Deposit collected at check-in',
            createdById: actorId,
          },
        });
      }

      await this.audit.record({
        tx,
        actorId,
        action: 'stay.create',
        entityType: 'Stay',
        entityId: stay.id,
        after: { tenantId, ...dto },
      });

      return stay;
    });
  }

  // --- Bed assignment ----------------------------------------------------

  async assignBed(stayId: string, dto: AssignBedDto, actorId: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const assignment = await this.assignBedInTx(
        tx,
        stayId,
        dto.bedId,
        dayStart(dto.startDate),
        dto.reason ?? 'Bed assigned',
        actorId,
      );
      await this.audit.record({
        tx,
        actorId,
        action: 'stay.assign_bed',
        entityType: 'BedAssignment',
        entityId: assignment.id,
        after: assignment,
        reason: dto.reason,
      });
      return assignment;
    });
  }

  /**
   * Places a stay in a bed from `startDate`. Refuses if the bed is taken for
   * any part of that period — this is the check that prevents double booking
   * and over-capacity, and it runs inside the serializable transaction so two
   * simultaneous assignments cannot both pass it.
   */
  private async assignBedInTx(
    tx: Db,
    stayId: string,
    bedId: string,
    startDate: Date,
    reason: string,
    actorId: string,
  ) {
    const bed = await tx.bed.findUnique({
      where: { id: bedId },
      include: { room: { include: { floor: true } } },
    });
    if (!bed) throw new NotFoundException('Bed not found');
    if (!bed.isActive) throw new BadRequestException('That bed is no longer in use');

    const conflicting = await tx.bedAssignment.findFirst({
      where: {
        bedId,
        stayId: { not: stayId },
        OR: [{ endDate: null }, { endDate: { gte: startDate } }],
        stay: { status: { not: StayStatus.CANCELLED } },
      },
      include: { stay: { include: { tenant: true } } },
    });
    if (conflicting) {
      throw new BadRequestException(
        `${bed.room.name} bed ${bed.label} is occupied by ${conflicting.stay.tenant.fullName}${
          conflicting.endDate
            ? ` until ${conflicting.endDate.toDateString()}`
            : ''
        }.`,
      );
    }

    // Close any open assignment this stay already has.
    await tx.bedAssignment.updateMany({
      where: { stayId, endDate: null },
      data: {
        endDate: addDaysTo(startDate, -1),
        endReason: AssignmentEndReason.ROOM_SWITCH,
      },
    });

    return tx.bedAssignment.create({
      data: { stayId, bedId, startDate, reason, createdById: actorId },
    });
  }

  /**
   * Preview for the Switch Room confirmation screen: what changes, what it
   * costs, and whether the move requires swapping with the current occupant.
   */
  async previewSwitch(stayId: string, toBedId: string, effectiveDate: string) {
    const on = dayStart(effectiveDate);

    const stay = await this.prisma.stay.findUnique({
      where: { id: stayId },
      include: {
        tenant: true,
        assignments: {
          where: { endDate: null },
          include: {
            bed: { include: { room: { include: { floor: { include: { branch: true } } } } } },
          },
        },
        foodPeriods: {
          where: {
            effectiveFrom: { lte: on },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });
    if (!stay) throw new NotFoundException('Stay not found');

    const toBed = await this.prisma.bed.findUnique({
      where: { id: toBedId },
      include: { room: { include: { floor: { include: { branch: true } } } } },
    });
    if (!toBed) throw new NotFoundException('Destination bed not found');

    const occupant = await this.prisma.bedAssignment.findFirst({
      where: {
        bedId: toBedId,
        endDate: null,
        stayId: { not: stayId },
        stay: { status: { not: StayStatus.CANCELLED } },
      },
      include: { stay: { include: { tenant: true } } },
    });

    const foodIncluded = stay.foodPeriods[0]?.foodIncluded ?? false;
    const current = stay.assignments[0];

    const currentRent = current
      ? await this.pricing.resolveRent({
          stayId,
          roomId: current.bed.roomId,
          branchId: current.bed.room.floor.branchId,
          capacity: current.bed.room.capacity,
          acType: current.bed.room.acType,
          variant: current.bed.room.variant,
          foodIncluded,
          on,
        })
      : null;

    const newRent = await this.pricing.resolveRent({
      stayId,
      roomId: toBed.roomId,
      branchId: toBed.room.floor.branchId,
      capacity: toBed.room.capacity,
      acType: toBed.room.acType,
      variant: toBed.room.variant,
      foodIncluded,
      on,
    });

    const difference = newRent.monthlyRent.minus(currentRent?.monthlyRent ?? 0);

    return {
      effectiveDate: on,
      tenant: { id: stay.tenantId, name: stay.tenant.fullName },
      from: current
        ? {
            branchName: current.bed.room.floor.branch.name,
            floorName: current.bed.room.floor.name,
            roomName: current.bed.room.name,
            bedLabel: current.bed.label,
            capacity: current.bed.room.capacity,
            acType: current.bed.room.acType,
            monthlyRent: currentRent?.monthlyRent.toFixed(2) ?? null,
          }
        : null,
      to: {
        branchName: toBed.room.floor.branch.name,
        floorName: toBed.room.floor.name,
        roomName: toBed.room.name,
        bedLabel: toBed.label,
        capacity: toBed.room.capacity,
        acType: toBed.room.acType,
        monthlyRent: newRent.monthlyRent.toFixed(2),
      },
      rentDifference: difference.toFixed(2),
      foodIncluded,
      requiresSwap: Boolean(occupant),
      swapWith: occupant
        ? {
            stayId: occupant.stayId,
            tenantId: occupant.stay.tenantId,
            tenantName: occupant.stay.tenant.fullName,
          }
        : null,
      crossBranch:
        current != null &&
        current.bed.room.floor.branchId !== toBed.room.floor.branchId,
    };
  }

  /**
   * Moves a tenant to another bed — same floor, another floor or another
   * branch. When the destination is occupied and `allowSwap` is set, the two
   * tenants exchange beds. The whole move is one transaction: it either
   * happens completely or not at all.
   */
  async switchRoom(stayId: string, dto: SwitchRoomDto, actorId: string) {
    const effective = dayStart(dto.effectiveDate);

    return this.prisma.runInTransaction(async (tx) => {
      const current = await tx.bedAssignment.findFirst({
        where: { stayId, endDate: null },
        include: { bed: true },
      });

      const occupant = await tx.bedAssignment.findFirst({
        where: {
          bedId: dto.toBedId,
          endDate: null,
          stayId: { not: stayId },
          stay: { status: { not: StayStatus.CANCELLED } },
        },
        include: { stay: { include: { tenant: true } } },
      });

      if (occupant && !dto.allowSwap) {
        throw new BadRequestException(
          `That bed is occupied by ${occupant.stay.tenant.fullName}. Confirm a swap to move both tenants.`,
        );
      }
      if (occupant && !current) {
        throw new BadRequestException(
          'This tenant has no current bed, so there is nothing to swap.',
        );
      }

      const dayBefore = addDaysTo(effective, -1);

      // Close both sides first, so neither bed looks occupied while we reopen.
      await tx.bedAssignment.updateMany({
        where: { stayId, endDate: null },
        data: {
          endDate: dayBefore,
          endReason: occupant
            ? AssignmentEndReason.ROOM_SWAP
            : AssignmentEndReason.ROOM_SWITCH,
        },
      });
      if (occupant) {
        await tx.bedAssignment.update({
          where: { id: occupant.id },
          data: { endDate: dayBefore, endReason: AssignmentEndReason.ROOM_SWAP },
        });
      }

      const moved = await tx.bedAssignment.create({
        data: {
          stayId,
          bedId: dto.toBedId,
          startDate: effective,
          reason: dto.reason ?? (occupant ? 'Room swap' : 'Room switch'),
          createdById: actorId,
        },
      });

      let swapped = null;
      if (occupant && current) {
        swapped = await tx.bedAssignment.create({
          data: {
            stayId: occupant.stayId,
            bedId: current.bedId,
            startDate: effective,
            reason: dto.reason ?? 'Room swap',
            createdById: actorId,
          },
        });
      }

      await this.audit.record({
        tx,
        actorId,
        action: occupant ? 'stay.room_swap' : 'stay.room_switch',
        entityType: 'Stay',
        entityId: stayId,
        before: { bedId: current?.bedId ?? null },
        after: {
          bedId: dto.toBedId,
          effectiveDate: effective,
          swappedStayId: occupant?.stayId ?? null,
        },
        reason: dto.reason,
      });

      return { moved, swapped };
    });
  }

  // --- Food --------------------------------------------------------------

  /**
   * Changes food status from a date forward. The previous period is closed,
   * not replaced, so bills already issued keep the status they were billed on.
   */
  async changeFood(stayId: string, dto: ChangeFoodDto, actorId: string) {
    const effective = dayStart(dto.effectiveFrom);

    return this.prisma.runInTransaction(async (tx) => {
      const stay = await tx.stay.findUnique({ where: { id: stayId } });
      if (!stay) throw new NotFoundException('Stay not found');
      if (stay.stayType === StayType.DAILY && dto.foodIncluded) {
        throw new BadRequestException('Daily stays cannot include food');
      }

      const currentPeriod = await tx.foodPeriod.findFirst({
        where: {
          stayId,
          effectiveFrom: { lte: effective },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effective } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });

      if (currentPeriod?.foodIncluded === dto.foodIncluded) {
        throw new BadRequestException(
          `Food is already ${dto.foodIncluded ? 'included' : 'excluded'} from that date`,
        );
      }

      if (currentPeriod) {
        await tx.foodPeriod.update({
          where: { id: currentPeriod.id },
          data: { effectiveTo: addDaysTo(effective, -1) },
        });
      }

      // Any later periods are superseded by this change.
      await tx.foodPeriod.deleteMany({
        where: { stayId, effectiveFrom: { gt: effective } },
      });

      const created = await tx.foodPeriod.create({
        data: {
          stayId,
          foodIncluded: dto.foodIncluded,
          effectiveFrom: effective,
          reason: dto.reason,
          changedById: actorId,
        },
      });

      await this.audit.record({
        tx,
        actorId,
        action: 'stay.food_change',
        entityType: 'Stay',
        entityId: stayId,
        before: { foodIncluded: currentPeriod?.foodIncluded ?? null },
        after: { foodIncluded: dto.foodIncluded, effectiveFrom: effective },
        reason: dto.reason,
      });

      return created;
    });
  }

  // --- Tenant-specific rent ---------------------------------------------

  async setCustomRent(stayId: string, dto: SetCustomRentDto, actorId: string) {
    const rule = await this.pricing.createRule({
      scope: PricingScope.STAY,
      stayId,
      amountWithFood: dto.amount,
      effectiveFrom: new Date(dto.effectiveFrom),
      reason: dto.reason,
      createdById: actorId,
    });
    await this.audit.record({
      actorId,
      action: 'stay.custom_rent',
      entityType: 'Stay',
      entityId: stayId,
      after: rule,
      reason: dto.reason,
    });
    return rule;
  }

  // --- Notice ------------------------------------------------------------

  /**
   * Records a tenant's notice. The notice period in force on the notice date
   * is copied onto the record, so changing the setting later cannot
   * retroactively make a past notice short or long.
   */
  async giveNotice(stayId: string, dto: GiveNoticeDto, actorId: string) {
    const noticeDate = dayStart(dto.noticeDate);
    const intendedCheckout = dayStart(dto.intendedCheckout);

    if (intendedCheckout < noticeDate) {
      throw new BadRequestException('Checkout cannot be before the notice date');
    }

    const noticeDays = await this.settings.getIntAt(
      SETTING_KEYS.NOTICE_PERIOD_DAYS,
      noticeDate,
    );
    const requiredUntil = addDaysTo(noticeDate, noticeDays);
    const shortfallDays = Math.max(
      0,
      inclusiveDays(intendedCheckout, requiredUntil) - 1,
    );

    return this.prisma.runInTransaction(async (tx) => {
      const stay = await tx.stay.findUnique({ where: { id: stayId } });
      if (!stay) throw new NotFoundException('Stay not found');
      if (stay.status === StayStatus.VACATED) {
        throw new BadRequestException('This stay has already ended');
      }

      const notice = await tx.vacateNotice.upsert({
        where: { stayId },
        create: {
          stayId,
          noticeDate,
          requiredUntilDate: requiredUntil,
          noticeDaysRequired: noticeDays,
          intendedCheckout,
          shortfallDays,
          reason: dto.reason,
          createdById: actorId,
        },
        update: {
          noticeDate,
          requiredUntilDate: requiredUntil,
          noticeDaysRequired: noticeDays,
          intendedCheckout,
          shortfallDays,
          reason: dto.reason,
        },
      });

      await tx.stay.update({
        where: { id: stayId },
        data: {
          status: StayStatus.NOTICE_GIVEN,
          expectedCheckoutDate: intendedCheckout,
        },
      });

      await this.audit.record({
        tx,
        actorId,
        action: 'stay.notice',
        entityType: 'Stay',
        entityId: stayId,
        after: notice,
        reason: dto.reason,
      });

      return notice;
    });
  }

  async getStay(stayId: string) {
    const stay = await this.prisma.stay.findUnique({
      where: { id: stayId },
      include: {
        tenant: true,
        assignments: {
          orderBy: { startDate: 'desc' },
          include: {
            bed: { include: { room: { include: { floor: { include: { branch: true } } } } } },
          },
        },
        foodPeriods: { orderBy: { effectiveFrom: 'desc' } },
        pricingRules: { orderBy: { effectiveFrom: 'desc' } },
        notice: true,
        settlement: { include: { lines: true } },
      },
    });
    if (!stay) throw new NotFoundException('Stay not found');
    return stay;
  }
}
