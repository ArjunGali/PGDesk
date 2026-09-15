import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  startOfDay,
  startOfMonth,
} from 'date-fns';

/**
 * Occupancy and billing both work in whole local days. Times of day are
 * deliberately stripped: a tenant who checks in at 11pm still owes that day.
 */
export function dayStart(date: Date | string): Date {
  return startOfDay(typeof date === 'string' ? new Date(date) : date);
}

export function dayEnd(date: Date | string): Date {
  return endOfDay(typeof date === 'string' ? new Date(date) : date);
}

export function monthStart(date: Date): Date {
  return startOfMonth(date);
}

export function monthEnd(date: Date): Date {
  return endOfDay(endOfMonth(date));
}

/** Inclusive day count: Jan 1 to Jan 1 is 1 day of occupancy, not 0. */
export function inclusiveDays(from: Date, to: Date): number {
  return differenceInCalendarDays(dayStart(to), dayStart(from)) + 1;
}

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Overlap of two closed date ranges, or null. An open-ended range (no end) is
 * treated as running forever — that is how a current bed assignment is stored.
 */
export function intersectRanges(
  a: { start: Date; end: Date | null },
  b: { start: Date; end: Date | null },
): DateRange | null {
  const start = dayStart(a.start > b.start ? a.start : b.start);
  const aEnd = a.end ? dayStart(a.end) : null;
  const bEnd = b.end ? dayStart(b.end) : null;
  let end: Date;
  if (aEnd && bEnd) end = aEnd < bEnd ? aEnd : bEnd;
  else if (aEnd) end = aEnd;
  else if (bEnd) end = bEnd;
  else return { start, end: dayStart(start) }; // both open: caller clamps

  if (end < start) return null;
  return { start, end };
}

/** Days of `range` that fall inside `window`, inclusive. */
export function overlappingDays(
  range: { start: Date; end: Date | null },
  window: DateRange,
): number {
  const start = dayStart(range.start > window.start ? range.start : window.start);
  const rangeEnd = range.end ? dayStart(range.end) : dayStart(window.end);
  const end = rangeEnd < dayStart(window.end) ? rangeEnd : dayStart(window.end);
  if (end < start) return 0;
  return inclusiveDays(start, end);
}

export function rangesOverlap(
  a: { start: Date; end: Date | null },
  b: { start: Date; end: Date | null },
): boolean {
  const aStart = dayStart(a.start);
  const bStart = dayStart(b.start);
  const aEnd = a.end ? dayStart(a.end) : null;
  const bEnd = b.end ? dayStart(b.end) : null;
  if (aEnd && aEnd < bStart) return false;
  if (bEnd && bEnd < aStart) return false;
  return true;
}

export function addDaysTo(date: Date, days: number): Date {
  return addDays(dayStart(date), days);
}

export function toDateOnlyString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateOrThrow(value: string | Date, field = 'date'): Date {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return d;
}
