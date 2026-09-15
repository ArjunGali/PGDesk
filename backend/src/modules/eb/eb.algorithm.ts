import Decimal from 'decimal.js';
import { allocateByWeight, money, round2 } from '../../common/utils/money';

/**
 * THE E.B. CALCULATION ALGORITHM.
 *
 * This is the one piece of business logic the specification fixes in code.
 * Everything it consumes — the rate per unit, the split method, the
 * plausibility limit — still comes from configuration; only the *procedure* is
 * fixed:
 *
 *   1. Units consumed = end reading − start reading.
 *      If the end reading is flagged as a meter reset, the meter was replaced
 *      and started from zero, so the end reading IS the consumption. (Close
 *      the outgoing meter's own cycle before recording the reset.)
 *   2. A reading that goes backwards without a reset flag is rejected. It is
 *      a data-entry mistake, and silently billing a negative or wrapped value
 *      is worse than refusing.
 *   3. Total amount = units × rate per unit, rounded to 2 decimals.
 *   4. The total is divided between the tenants who occupied a bed in that
 *      room during the period:
 *        OCCUPIED_DAYS — weighted by the days each tenant was actually there,
 *                        so someone who joined mid-month pays their share.
 *        EQUAL         — divided evenly between everyone present at any point.
 *   5. Shares are allocated with largest-remainder rounding, so the parts add
 *      back to the total exactly. No paisa is invented or lost.
 *
 * The function is pure: same inputs, same output, no database, no clock. That
 * is what makes it testable and what makes a historical cycle reproducible.
 */

export type EbSplitMethod = 'OCCUPIED_DAYS' | 'EQUAL';

export interface EbOccupant {
  stayId: string;
  /** Days this stay occupied a bed in the metered room during the period. */
  occupiedDays: number;
}

export interface EbComputationInput {
  startReading: number | string | Decimal | null;
  endReading: number | string | Decimal;
  /** True when the end reading comes from a replaced/reset meter. */
  endIsReset: boolean;
  ratePerUnit: number | string | Decimal;
  periodDays: number;
  maxPlausibleUnitsPerDay: number;
  splitMethod: EbSplitMethod;
  occupants: EbOccupant[];
}

export interface EbShare {
  stayId: string;
  occupiedDays: number;
  shareRatio: Decimal;
  units: Decimal;
  amount: Decimal;
}

export interface EbComputationResult {
  unitsConsumed: Decimal;
  ratePerUnit: Decimal;
  totalAmount: Decimal;
  shares: EbShare[];
  /** Non-fatal observations for the reviewer, e.g. unusually high usage. */
  warnings: string[];
  /** Amount that could not be attributed because nobody occupied the room. */
  unallocatedAmount: Decimal;
}

export class EbCalculationError extends Error {}

export function computeEbCycle(input: EbComputationInput): EbComputationResult {
  const warnings: string[] = [];
  const end = money(input.endReading);
  const start = input.startReading === null ? null : money(input.startReading);
  const rate = money(input.ratePerUnit);

  if (rate.lessThanOrEqualTo(0)) {
    throw new EbCalculationError(
      'The E.B. rate per unit must be greater than zero. Set it under Settings → E.B.',
    );
  }

  // Step 1 & 2 — units consumed.
  let unitsConsumed: Decimal;
  if (input.endIsReset) {
    unitsConsumed = end;
    warnings.push(
      'The meter was reset or replaced during this period; the closing reading is being billed as the full consumption.',
    );
  } else if (start === null) {
    throw new EbCalculationError(
      'No opening reading is available for this meter. Record an opening reading before billing a cycle.',
    );
  } else if (end.lessThan(start)) {
    throw new EbCalculationError(
      `The closing reading (${end.toFixed(2)}) is lower than the opening reading (${start.toFixed(
        2,
      )}). Correct the reading, or mark it as a meter reset.`,
    );
  } else {
    unitsConsumed = end.minus(start);
  }

  unitsConsumed = round2(unitsConsumed);

  // Plausibility check — surfaced, never silently applied.
  if (input.periodDays > 0 && input.maxPlausibleUnitsPerDay > 0) {
    const perDay = unitsConsumed.dividedBy(input.periodDays);
    if (perDay.greaterThan(input.maxPlausibleUnitsPerDay)) {
      warnings.push(
        `Usage works out to ${perDay.toFixed(1)} units per day, above the configured limit of ${
          input.maxPlausibleUnitsPerDay
        }. Please check the readings before finalising.`,
      );
    }
  }

  // Step 3 — total.
  const totalAmount = round2(unitsConsumed.times(rate));

  // Step 4 — weights.
  const present = input.occupants.filter((o) => o.occupiedDays > 0);
  if (present.length === 0) {
    return {
      unitsConsumed,
      ratePerUnit: rate,
      totalAmount,
      shares: [],
      warnings: [
        ...warnings,
        'Nobody occupied this room during the period, so the whole amount is unattributed and stays with the property.',
      ],
      unallocatedAmount: totalAmount,
    };
  }

  const weights =
    input.splitMethod === 'EQUAL'
      ? present.map(() => 1)
      : present.map((o) => o.occupiedDays);

  // Step 5 — allocate so the parts sum exactly to the total.
  const amounts = allocateByWeight(totalAmount, weights);
  const unitShares = allocateByWeight(unitsConsumed, weights);
  const weightTotal = weights.reduce((a, b) => a + b, 0);

  const shares: EbShare[] = present.map((occupant, i) => ({
    stayId: occupant.stayId,
    occupiedDays: occupant.occupiedDays,
    shareRatio: new Decimal(weights[i]).dividedBy(weightTotal).toDecimalPlaces(6),
    units: unitShares[i],
    amount: amounts[i],
  }));

  return {
    unitsConsumed,
    ratePerUnit: rate,
    totalAmount,
    shares,
    warnings,
    unallocatedAmount: new Decimal(0),
  };
}
