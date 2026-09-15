import type Decimal from 'decimal.js';
import { AcType, ChargeKind } from '@prisma/client';

/**
 * A stretch of days within a billing period over which nothing that affects
 * the price changed: same room, same food status, same rate.
 */
export interface ChargeSegment {
  start: Date;
  end: Date;
  days: number;
  roomId: string | null;
  roomName: string | null;
  branchId: string | null;
  capacity: number | null;
  acType: AcType | null;
  foodIncluded: boolean;
  /** Room rate inclusive of food. */
  baseWithFood: Decimal;
  /** Food component of that rate on this date. */
  foodDifference: Decimal;
  /** Rent excluding the food component. */
  rentComponent: Decimal;
  /** Days used as the divisor for the daily rate. */
  divisorDays: number;
  pricingRuleId: string | null;
}

export interface ComputedLine {
  kind: ChargeKind;
  description: string;
  quantity: Decimal;
  unitAmount: Decimal;
  amount: Decimal;
  calcSnapshot: unknown;
  sourceId?: string | null;
}

export interface ComputedCharges {
  periodStart: Date;
  periodEnd: Date;
  lines: ComputedLine[];
  total: Decimal;
  segments: ChargeSegment[];
}
