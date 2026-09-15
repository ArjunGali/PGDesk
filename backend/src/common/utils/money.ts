import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

/**
 * All money in this application is a fixed-point decimal with 2 places.
 * Never use JavaScript numbers for money arithmetic: 0.1 + 0.2 problems become
 * rupee discrepancies that a PG owner has to explain to a tenant.
 */
export type MoneyInput = Prisma.Decimal | Decimal | number | string | null | undefined;

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export const ZERO = new Decimal(0);

export function money(value: MoneyInput): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  if (value instanceof Decimal) return value;
  return new Decimal(value.toString());
}

/** Rounds to 2 decimal places, half-up — the convention on printed bills. */
export function round2(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function sum(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

/** Prisma accepts a decimal string for Decimal columns. */
export function toDb(value: MoneyInput): Prisma.Decimal {
  return new Prisma.Decimal(round2(value).toFixed(2));
}

export function toNumber(value: MoneyInput): number {
  return round2(value).toNumber();
}

export function isZero(value: MoneyInput): boolean {
  return round2(value).isZero();
}

export function isNegative(value: MoneyInput): boolean {
  return round2(value).isNegative();
}

/**
 * Splits an amount across weights so the parts always add back to the total.
 * The largest-remainder method puts leftover paise on the biggest shares
 * instead of letting rounding quietly lose or invent money.
 */
export function allocateByWeight(
  total: MoneyInput,
  weights: number[],
): Decimal[] {
  const totalDec = round2(total);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (weightSum <= 0) {
    // No usable weights: split evenly rather than dividing by zero.
    return allocateByWeight(totalDec, weights.map(() => 1));
  }

  const raw = weights.map((w) => totalDec.times(w).dividedBy(weightSum));
  const floored = raw.map((r) => r.toDecimalPlaces(2, Decimal.ROUND_DOWN));
  let remainder = totalDec.minus(floored.reduce((a, b) => a.plus(b), new Decimal(0)));

  // Distribute the remaining paise, biggest fractional part first.
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(floored[i]) }))
    .sort((a, b) => b.frac.comparedTo(a.frac));

  const step = new Decimal('0.01');
  let idx = 0;
  while (remainder.greaterThanOrEqualTo(step) && order.length > 0) {
    const target = order[idx % order.length].i;
    floored[target] = floored[target].plus(step);
    remainder = remainder.minus(step);
    idx += 1;
  }

  return floored;
}

export function formatINR(value: MoneyInput): string {
  const n = round2(value);
  const negative = n.isNegative();
  const [intPart, decPart] = n.abs().toFixed(2).split('.');
  // Indian grouping: last 3 digits, then pairs.
  let grouped = intPart;
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  return `${negative ? '-' : ''}₹${grouped}.${decPart}`;
}
