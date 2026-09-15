import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AcType, PricingScope, Prisma, StayType } from '@prisma/client';
import Decimal from 'decimal.js';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { dayStart } from '../../common/utils/dates';
import { money, toDb } from '../../common/utils/money';
import { SETTING_KEYS } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';

/** Most specific wins. Higher number = more specific. */
const SCOPE_SPECIFICITY: Record<PricingScope, number> = {
  [PricingScope.GLOBAL]: 0,
  [PricingScope.BRANCH]: 1,
  [PricingScope.SHARING]: 2,
  [PricingScope.ROOM]: 3,
  [PricingScope.STAY]: 4,
};

export interface RentContext {
  stayId?: string | null;
  roomId?: string | null;
  branchId?: string | null;
  capacity?: number | null;
  acType?: AcType | null;
  variant?: string | null;
  foodIncluded: boolean;
  /** The rate in force on this date is used. */
  on: Date;
}

export interface ResolvedRent {
  /** The room rate including food, before the food deduction. */
  baseWithFood: Decimal;
  /** Deduction applied because the tenant opted out of food. */
  foodDifference: Decimal;
  /** What the tenant actually pays per month. */
  monthlyRent: Decimal;
  source: {
    scope: PricingScope;
    ruleId: string | null;
    effectiveFrom: Date | null;
    reason: string | null;
  };
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Resolves the rent that applies to a stay on a date.
   *
   * Rules are stored inclusive of food so there is a single number per room
   * type to maintain. A tenant without food pays that number minus the
   * configured food difference — and because the difference is read for the
   * date in question, changing it later never rewrites an old bill.
   */
  async resolveRent(ctx: RentContext, db: Db = this.prisma): Promise<ResolvedRent> {
    const on = dayStart(ctx.on);

    const candidates = await db.pricingRule.findMany({
      where: {
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
        AND: [
          {
            OR: [
              ctx.stayId ? { scope: PricingScope.STAY, stayId: ctx.stayId } : undefined,
              ctx.roomId ? { scope: PricingScope.ROOM, roomId: ctx.roomId } : undefined,
              ctx.branchId
                ? {
                    scope: PricingScope.SHARING,
                    branchId: ctx.branchId,
                    capacity: ctx.capacity ?? undefined,
                    acType: ctx.acType ?? undefined,
                    variant: ctx.variant ?? null,
                  }
                : undefined,
              ctx.branchId
                ? {
                    scope: PricingScope.BRANCH,
                    branchId: ctx.branchId,
                    capacity: ctx.capacity ?? null,
                  }
                : undefined,
              {
                scope: PricingScope.GLOBAL,
                capacity: ctx.capacity ?? undefined,
                acType: ctx.acType ?? undefined,
              },
            ].filter(Boolean) as Prisma.PricingRuleWhereInput[],
          },
        ],
      },
    });

    if (candidates.length === 0) {
      throw new NotFoundException(
        `No price is configured for this room${
          ctx.capacity ? ` (${ctx.capacity} sharing${ctx.acType === AcType.AC ? ', AC' : ''})` : ''
        }. Add one under Settings → Pricing.`,
      );
    }

    // Most specific scope; among equals, the most recently effective rule.
    const best = candidates.sort((a, b) => {
      const s = SCOPE_SPECIFICITY[b.scope] - SCOPE_SPECIFICITY[a.scope];
      if (s !== 0) return s;
      const d = b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
      if (d !== 0) return d;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })[0];

    const baseWithFood = money(best.amountWithFood);
    const foodDifference = ctx.foodIncluded
      ? new Decimal(0)
      : await this.settings.getMoneyAt(SETTING_KEYS.FOOD_DIFFERENCE_MONTHLY, on);

    const monthlyRent = Decimal.max(baseWithFood.minus(foodDifference), 0);

    return {
      baseWithFood,
      foodDifference,
      monthlyRent,
      source: {
        scope: best.scope,
        ruleId: best.id,
        effectiveFrom: best.effectiveFrom,
        reason: best.reason,
      },
    };
  }

  /** Per-day tariff for a DAILY stay. Daily stays never carry food. */
  async resolveDailyRate(ctx: Omit<RentContext, 'foodIncluded'>, db: Db = this.prisma) {
    try {
      const resolved = await this.resolveRent({ ...ctx, foodIncluded: false }, db);
      // A daily-scope rule is stored as the per-day amount directly.
      const stayRule = resolved.source.scope === PricingScope.STAY;
      if (stayRule) return resolved.monthlyRent;
    } catch {
      // fall through to the configured default
    }
    return this.settings.getMoneyAt(
      SETTING_KEYS.DAILY_STAY_DEFAULT_RATE,
      dayStart(ctx.on),
    );
  }

  /**
   * Convenience wrapper: works out the room and food status for a stay itself,
   * so callers don't have to reassemble the context.
   */
  async resolveRentForStay(
    stayId: string,
    on: Date,
    db: Db = this.prisma,
  ): Promise<ResolvedRent & { stayType: StayType }> {
    const day = dayStart(on);
    const stay = await db.stay.findUnique({
      where: { id: stayId },
      include: {
        assignments: {
          where: {
            startDate: { lte: day },
            OR: [{ endDate: null }, { endDate: { gte: day } }],
          },
          include: { bed: { include: { room: { include: { floor: true } } } } },
          orderBy: { startDate: 'desc' },
          take: 1,
        },
        foodPeriods: {
          where: {
            effectiveFrom: { lte: day },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });
    if (!stay) throw new NotFoundException('Stay not found');

    const room = stay.assignments[0]?.bed.room;
    const foodIncluded =
      stay.stayType === StayType.DAILY
        ? false
        : (stay.foodPeriods[0]?.foodIncluded ?? false);

    const resolved = await this.resolveRent(
      {
        stayId,
        roomId: room?.id ?? null,
        branchId: room?.floor.branchId ?? null,
        capacity: room?.capacity ?? null,
        acType: room?.acType ?? null,
        variant: room?.variant ?? null,
        foodIncluded,
        on: day,
      },
      db,
    );
    return { ...resolved, stayType: stay.stayType };
  }

  // --- Rule management ---------------------------------------------------

  async listRules(filter: {
    scope?: PricingScope;
    branchId?: string;
    roomId?: string;
    stayId?: string;
    includeExpired?: boolean;
  }) {
    const now = dayStart(new Date());
    return this.prisma.pricingRule.findMany({
      where: {
        scope: filter.scope,
        branchId: filter.branchId,
        roomId: filter.roomId,
        stayId: filter.stayId,
        ...(filter.includeExpired
          ? {}
          : { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }),
      },
      orderBy: [{ scope: 'desc' }, { effectiveFrom: 'desc' }],
      include: {
        branch: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Creates a rule. An existing rule at the same scope is closed the day
   * before the new one starts rather than edited, so previous bills stay
   * explainable.
   */
  async createRule(input: {
    scope: PricingScope;
    branchId?: string;
    roomId?: string;
    stayId?: string;
    capacity?: number;
    acType?: AcType;
    variant?: string;
    amountWithFood: string | number;
    effectiveFrom: Date;
    reason?: string;
    createdById?: string;
  }) {
    this.validateScope(input);
    const from = dayStart(input.effectiveFrom);

    return this.prisma.runInTransaction(async (tx) => {
      const supersede = await tx.pricingRule.findMany({
        where: {
          scope: input.scope,
          branchId: input.branchId ?? null,
          roomId: input.roomId ?? null,
          stayId: input.stayId ?? null,
          capacity: input.capacity ?? null,
          acType: input.acType ?? null,
          variant: input.variant ?? null,
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
        },
      });

      for (const rule of supersede) {
        const closeAt = new Date(from.getTime() - 24 * 60 * 60 * 1000);
        if (rule.effectiveFrom > closeAt) {
          // The new rule starts before the old one — the old one never applied.
          await tx.pricingRule.delete({ where: { id: rule.id } });
        } else {
          await tx.pricingRule.update({
            where: { id: rule.id },
            data: { effectiveTo: closeAt },
          });
        }
      }

      return tx.pricingRule.create({
        data: {
          scope: input.scope,
          branchId: input.branchId ?? null,
          roomId: input.roomId ?? null,
          stayId: input.stayId ?? null,
          capacity: input.capacity ?? null,
          acType: input.acType ?? null,
          variant: input.variant ?? null,
          amountWithFood: toDb(input.amountWithFood),
          effectiveFrom: from,
          reason: input.reason,
          createdById: input.createdById,
        },
      });
    });
  }

  private validateScope(input: {
    scope: PricingScope;
    branchId?: string;
    roomId?: string;
    stayId?: string;
    capacity?: number;
  }): void {
    switch (input.scope) {
      case PricingScope.STAY:
        if (!input.stayId) throw new BadRequestException('stayId is required for a tenant price');
        break;
      case PricingScope.ROOM:
        if (!input.roomId) throw new BadRequestException('roomId is required for a room price');
        break;
      case PricingScope.SHARING:
        if (!input.branchId || !input.capacity) {
          throw new BadRequestException(
            'branchId and capacity are required for a sharing price',
          );
        }
        break;
      case PricingScope.BRANCH:
        if (!input.branchId) throw new BadRequestException('branchId is required for a branch price');
        break;
      default:
        break;
    }
  }
}
