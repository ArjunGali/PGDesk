import Decimal from 'decimal.js';
import { allocateByWeight, money, round2 } from '../../common/utils/money';

/**
 * THE E.B. CALCULATION ALGORITHM.
 *
 * This is the one piece of business logic the specification fixes in code.
 * Everything it consumes — the rate per unit, the split rule, the plausibility
 * limit, the room's sharing capacity — comes from configuration or from the
 * property structure. Only the *procedure* below is fixed.
 *
 *   1. Units consumed = closing reading − opening reading.
 *      If the closing reading is flagged as a meter reset, the meter was
 *      replaced and started from zero, so that reading IS the consumption.
 *      (Close the outgoing meter's own cycle before recording the reset.)
 *   2. A reading that goes backwards without a reset flag is rejected. It is a
 *      data-entry mistake, and silently billing a wrapped or negative value is
 *      worse than refusing.
 *   3. Total amount = units × rate per unit, rounded to 2 decimals.
 *   4. The total is divided by the configured rule:
 *
 *      ROOM_CAPACITY (default) — each tenant carries one bed's worth of the
 *        room, i.e. 1/capacity, pro-rated for the days they were responsible.
 *        A tenant in a 2-sharing room pays half the room's electricity from
 *        their check-in date onward *even if the second bed is empty*, because
 *        they are billed for their share of the room, not for the room. The
 *        portion belonging to empty beds is NOT redistributed onto the people
 *        who happen to be there — it is reported as the owner's share.
 *
 *      OCCUPIED_DAYS — the room total is divided between whoever was actually
 *        present, weighted by days. An empty bed therefore increases what the
 *        remaining tenants pay. Available for properties that bill this way.
 *
 *      EQUAL — divided evenly between everyone present at any point in the
 *        period, ignoring how long each stayed.
 *
 *   5. Shares are allocated with largest-remainder rounding, so the parts plus
 *      the owner's share add back to the total exactly. No paisa is invented
 *      or lost.
 *
 * The function is pure: same inputs, same output, no database, no clock. That
 * is what makes a historical cycle reproducible and the rule testable.
 */

export type EbSplitMethod = 'ROOM_CAPACITY' | 'OCCUPIED_DAYS' | 'EQUAL';

export interface EbOccupant {
  stayId: string;
  /**
   * Days in the period this stay was responsible for a bed in the metered
   * room. Under ROOM_CAPACITY this runs from check-in (or the start of the
   * period) to checkout (or the end of it) — responsibility, not attendance.
   */
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
  /**
   * Beds in the metered room. Required by ROOM_CAPACITY, which needs to know
   * what one tenant's share of the room actually is.
   */
  roomCapacity?: number | null;
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
  /**
   * The part of the bill no tenant is responsible for — empty beds under
   * ROOM_CAPACITY, or a room nobody occupied at all. This is the owner's
   * share. It is reported rather than redistributed, so the owner can see
   * exactly what vacancy is costing them.
   */
  unallocatedAmount: Decimal;
  /** Which rule produced these shares, recorded on the finalised cycle. */
  splitMethod: EbSplitMethod;
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

  // Step 4 — who owes what.
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
      splitMethod: input.splitMethod,
    };
  }

  if (input.splitMethod === 'ROOM_CAPACITY') {
    return allocateByRoomCapacity(input, present, unitsConsumed, rate, totalAmount, warnings);
  }

  // OCCUPIED_DAYS and EQUAL both divide the whole room total between whoever
  // was there; they differ only in the weight each person carries.
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
    splitMethod: input.splitMethod,
  };
}

/**
 * Each tenant carries one bed's worth of the room — 1/capacity — pro-rated for
 * the days they were responsible for it.
 *
 * The whole point of this rule is that an empty bed costs the *owner*, not the
 * tenant who happens to be sharing the room. Someone alone in a 2-sharing room
 * pays half the electricity; the other half is reported as the owner's share
 * rather than being loaded onto them.
 */
function allocateByRoomCapacity(
  input: EbComputationInput,
  present: EbOccupant[],
  unitsConsumed: Decimal,
  rate: Decimal,
  totalAmount: Decimal,
  warnings: string[],
): EbComputationResult {
  const capacity = input.roomCapacity ?? 0;
  if (capacity <= 0) {
    throw new EbCalculationError(
      'This meter is not attached to a room with a sharing capacity, so the per-bed split cannot be worked out. Attach the meter to a room, or change the E.B. split rule under Settings.',
    );
  }
  if (input.periodDays <= 0) {
    throw new EbCalculationError('The billing period must cover at least one day.');
  }

  // A tenant cannot be responsible for more days than the period holds.
  const clamped = present.map((o) => ({
    ...o,
    occupiedDays: Math.min(o.occupiedDays, input.periodDays),
  }));

  if (clamped.length > capacity) {
    warnings.push(
      `${clamped.length} tenants were responsible for a ${capacity}-sharing room during this period; each is still charged one bed's share for their own days.`,
    );
  }

  // Ratio per tenant = (1 / capacity) × (their days / period days).
  const ratios = clamped.map((o) =>
    new Decimal(1)
      .dividedBy(capacity)
      .times(o.occupiedDays)
      .dividedBy(input.periodDays),
  );

  const claimed = ratios.reduce((acc, r) => acc.plus(r), new Decimal(0));

  // Work in whole paise so the tenants' shares and the owner's remainder add
  // back to the total exactly.
  const shares: EbShare[] = clamped.map((occupant, i) => ({
    stayId: occupant.stayId,
    occupiedDays: occupant.occupiedDays,
    shareRatio: ratios[i].toDecimalPlaces(6),
    units: round2(unitsConsumed.times(ratios[i])),
    amount: round2(totalAmount.times(ratios[i])),
  }));

  const allocated = shares.reduce((acc, s) => acc.plus(s.amount), new Decimal(0));
  const unallocated = round2(totalAmount.minus(allocated));

  if (unallocated.greaterThan(0)) {
    const vacantShare = new Decimal(1).minus(claimed).times(100);
    warnings.push(
      `${vacantShare.toDecimalPlaces(1)}% of this room's electricity (₹${unallocated.toFixed(
        2,
      )}) belongs to beds that were empty or unoccupied for part of the period, and stays with the property.`,
    );
  }

  return {
    unitsConsumed,
    ratePerUnit: rate,
    totalAmount,
    // A negative remainder would mean over-allocation; clamp so the reported
    // owner share is never nonsensical.
    shares,
    warnings,
    unallocatedAmount: unallocated.isNegative() ? new Decimal(0) : unallocated,
    splitMethod: 'ROOM_CAPACITY',
  };
}
