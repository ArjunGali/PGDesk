import { Test } from '@nestjs/testing';
import { AcType, ChargeKind, StayType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { SETTING_KEYS } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import { BillingService } from './billing.service';

/**
 * The invariant these tests protect: the configured room price is inclusive of
 * food, so RENT + FOOD on a bill must add back to exactly that price. Adding
 * the food difference on top of the full price would charge it twice.
 */
describe('BillingService.computeCharges', () => {
  const ROOM_PRICE_WITH_FOOD = '12000';
  const FOOD_DIFFERENCE = '2000';
  const COMMON_CHARGE = '150';

  const room = {
    id: 'room-1',
    name: 'G3',
    capacity: 3,
    acType: AcType.AC,
    variant: null,
    floor: { branchId: 'branch-1' },
  };

  function buildStay(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'stay-1',
      stayType: StayType.MONTHLY,
      checkInDate: new Date(2026, 8, 1),
      actualCheckoutDate: null,
      tenant: { fullName: 'Test Tenant' },
      assignments: [
        { startDate: new Date(2026, 8, 1), endDate: null, bed: { room } },
      ],
      foodPeriods: [
        {
          foodIncluded: true,
          effectiveFrom: new Date(2026, 8, 1),
          effectiveTo: null,
        },
      ],
      ...overrides,
    };
  }

  async function createService(stay: unknown) {
    const settings: Partial<SettingsService> = {
      getMoneyAt: jest.fn(async (key: string) => {
        if (key === SETTING_KEYS.FOOD_DIFFERENCE_MONTHLY) {
          return new Decimal(FOOD_DIFFERENCE);
        }
        if (key === SETTING_KEYS.COMMON_CHARGE_MONTHLY) {
          return new Decimal(COMMON_CHARGE);
        }
        return new Decimal(0);
      }) as SettingsService['getMoneyAt'],
      getString: jest.fn(async (key: string) => {
        if (key === SETTING_KEYS.BILLING_PRORATION) return 'DAILY';
        if (key === SETTING_KEYS.BILLING_PRORATION_BASIS) return 'ACTUAL_DAYS';
        return '';
      }) as SettingsService['getString'],
      getInt: jest.fn(async () => 30) as SettingsService['getInt'],
      getBoolean: jest.fn(async () => true) as SettingsService['getBoolean'],
    };

    const pricing: Partial<PricingService> = {
      resolveRent: jest.fn(async ({ foodIncluded }) => ({
        baseWithFood: new Decimal(ROOM_PRICE_WITH_FOOD),
        foodDifference: foodIncluded
          ? new Decimal(0)
          : new Decimal(FOOD_DIFFERENCE),
        monthlyRent: foodIncluded
          ? new Decimal(ROOM_PRICE_WITH_FOOD)
          : new Decimal(ROOM_PRICE_WITH_FOOD).minus(FOOD_DIFFERENCE),
        source: {
          scope: 'SHARING' as never,
          ruleId: 'rule-1',
          effectiveFrom: new Date(2020, 0, 1),
          reason: null,
        },
      })) as PricingService['resolveRent'],
    };

    const prisma = {
      stay: { findUnique: jest.fn(async () => stay) },
      ebCharge: { findMany: jest.fn(async () => []) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingService, useValue: pricing },
        { provide: SettingsService, useValue: settings },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    return moduleRef.get(BillingService);
  }

  const total = (lines: Array<{ kind: ChargeKind; amount: Decimal }>, kind: ChargeKind) =>
    lines
      .filter((l) => l.kind === kind)
      .reduce((acc, l) => acc.plus(l.amount), new Decimal(0));

  it('splits a food-inclusive room price into rent and food without double charging', async () => {
    const service = await createService(buildStay());
    const result = await service.computeCharges(
      'stay-1',
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
    );

    const rent = total(result.lines, ChargeKind.RENT);
    const food = total(result.lines, ChargeKind.FOOD);

    // Rent + food must equal the configured price, not price + food.
    expect(rent.plus(food).toFixed(2)).toBe('12000.00');
    expect(rent.toFixed(2)).toBe('10000.00');
    expect(food.toFixed(2)).toBe('2000.00');
    expect(result.total.toFixed(2)).toBe('12150.00');
  });

  it('charges no food line, and the reduced rent, when food is not taken', async () => {
    const service = await createService(
      buildStay({
        foodPeriods: [
          {
            foodIncluded: false,
            effectiveFrom: new Date(2026, 8, 1),
            effectiveTo: null,
          },
        ],
      }),
    );
    const result = await service.computeCharges(
      'stay-1',
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
    );

    expect(total(result.lines, ChargeKind.RENT).toFixed(2)).toBe('10000.00');
    expect(total(result.lines, ChargeKind.FOOD).toFixed(2)).toBe('0.00');
    expect(result.total.toFixed(2)).toBe('10150.00');
  });

  it('pro-rates each side of a mid-month food change separately', async () => {
    const service = await createService(
      buildStay({
        foodPeriods: [
          {
            foodIncluded: true,
            effectiveFrom: new Date(2026, 8, 1),
            effectiveTo: new Date(2026, 8, 15),
          },
          {
            foodIncluded: false,
            effectiveFrom: new Date(2026, 8, 16),
            effectiveTo: null,
          },
        ],
      }),
    );
    const result = await service.computeCharges(
      'stay-1',
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
    );

    // 30-day month: rent is the same either way, food is charged for 15 days.
    expect(total(result.lines, ChargeKind.RENT).toFixed(2)).toBe('10000.00');
    expect(total(result.lines, ChargeKind.FOOD).toFixed(2)).toBe('1000.00');
    expect(result.segments).toHaveLength(2);
  });

  it('bills only the days stayed when the tenant checks in mid-period', async () => {
    const service = await createService(
      buildStay({
        checkInDate: new Date(2026, 8, 16),
        assignments: [
          { startDate: new Date(2026, 8, 16), endDate: null, bed: { room } },
        ],
        foodPeriods: [
          {
            foodIncluded: true,
            effectiveFrom: new Date(2026, 8, 16),
            effectiveTo: null,
          },
        ],
      }),
    );
    const result = await service.computeCharges(
      'stay-1',
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
    );

    // 15 of 30 days => half the room price, plus half the common charge.
    expect(total(result.lines, ChargeKind.RENT).toFixed(2)).toBe('5000.00');
    expect(total(result.lines, ChargeKind.FOOD).toFixed(2)).toBe('1000.00');
    expect(total(result.lines, ChargeKind.COMMON).toFixed(2)).toBe('75.00');
  });

  it('bills nothing for a period entirely before the stay began', async () => {
    const service = await createService(buildStay());
    const result = await service.computeCharges(
      'stay-1',
      new Date(2026, 6, 1),
      new Date(2026, 6, 31),
    );

    expect(result.lines).toHaveLength(0);
    expect(result.total.toFixed(2)).toBe('0.00');
  });
});
