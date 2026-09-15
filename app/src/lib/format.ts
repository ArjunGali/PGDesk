/** Money is always rendered from the server's decimal strings, never parsed into floats for display. */
export function formatMoney(
  value: string | number | null | undefined,
  options: { compact?: boolean; sign?: boolean } = {},
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return '—';

  const negative = n < 0;
  const abs = Math.abs(n);

  if (options.compact && abs >= 100000) {
    const lakhs = abs / 100000;
    return `${negative ? '-' : options.sign ? '+' : ''}₹${lakhs.toFixed(
      lakhs >= 10 ? 0 : 1,
    )}L`;
  }

  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(abs);

  const prefix = negative ? '-' : options.sign && n > 0 ? '+' : '';
  return `${prefix}₹${formatted}`;
}

export function formatDate(
  value: string | Date | null | undefined,
  style: 'short' | 'long' | 'day' = 'short',
): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  if (style === 'day') {
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(date);
  }
  if (style === 'long') {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(date);
  }
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** "in 3 days" / "12 days ago" — friendlier than a bare date under the bell. */
export function relativeDays(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

/** yyyy-mm-dd for date inputs and API parameters. */
export function toInputDate(value: Date | string = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function startOfMonth(date = new Date()): string {
  return toInputDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function endOfMonth(date = new Date()): string {
  return toInputDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export function describeSharing(
  capacity: number | null | undefined,
  acType: string | null | undefined,
  variant?: string | null,
): string {
  if (!capacity) return '—';
  const parts = [`${capacity} sharing`];
  if (acType) parts.push(acType === 'AC' ? 'AC' : 'Non-AC');
  if (variant) parts.push(variant);
  return parts.join(' · ');
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
