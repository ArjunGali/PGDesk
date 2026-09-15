import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon, WarningIcon } from './Icons';

/** Consistent page padding and max width across phone, tablet and landscape. */
export function Page({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1400px] px-4 sm:px-6 pb-28 pt-4 ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 mb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-sm text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

export function Card({
  children,
  className = '',
  onClick,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  as?: 'div' | 'button';
}) {
  const classes = `card shadow-card ${
    onClick ? 'text-left w-full hover:border-line-strong transition-colors active:scale-[0.995]' : ''
  } ${className}`;

  if (as === 'button' || onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {children}
      </button>
    );
  }
  return <div className={classes}>{children}</div>;
}

export function Section({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-6 ${className}`}>
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="stat-label">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Label/value row — the workhorse of every detail screen. */
export function Field({
  label,
  value,
  tone = 'default',
  mono = false,
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'muted' | 'positive' | 'critical';
  mono?: boolean;
}) {
  const toneClass = {
    default: 'text-ink',
    muted: 'text-ink-muted',
    positive: 'text-positive',
    critical: 'text-critical',
  }[tone];

  return (
    <div className="py-2.5 border-b border-line last:border-0">
      <dt className="text-xs uppercase tracking-wider text-ink-muted mb-0.5">{label}</dt>
      <dd className={`${toneClass} ${mono ? 'tabular' : ''} font-medium break-words`}>
        {value === null || value === undefined || value === '' ? '—' : value}
      </dd>
    </div>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'caution' | 'critical' | 'accent';
}) {
  const tones = {
    neutral: 'text-ink-muted',
    positive: 'text-positive border-positive/35',
    caution: 'text-caution border-caution/35',
    critical: 'text-critical border-critical/35',
    accent: 'text-accent border-accent/35',
  };
  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

export function Dot({ tone = 'neutral' }: { tone?: 'neutral' | 'positive' | 'caution' | 'critical' }) {
  const tones = {
    neutral: 'bg-ink-faint',
    positive: 'bg-positive',
    caution: 'bg-caution',
    critical: 'bg-critical',
  };
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${tones[tone]}`} />;
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card px-6 py-12 text-center">
      {icon && <div className="text-ink-faint mb-3 flex justify-center">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {message && <p className="text-sm text-ink-muted mt-1.5 max-w-sm mx-auto">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof Error ? error.message : 'Something went wrong loading this.';
  return (
    <div className="card px-6 py-10 text-center">
      <div className="text-caution mb-3 flex justify-center">
        <WarningIcon size={28} />
      </div>
      <p className="font-medium">Could not load</p>
      <p className="text-sm text-ink-muted mt-1.5 max-w-md mx-auto">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-5">
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-raised ${className}`} />;
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

/**
 * Bottom sheet on a phone, centred dialog on a tablet. Frosted glass, because
 * an overlay is exactly where it belongs.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Stop the page behind from scrolling under the sheet.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/55 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`relative glass border-t sm:border rounded-t-2xl sm:rounded-card
                    w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}
                    max-h-[92vh] sm:max-h-[88vh] flex flex-col
                    shadow-lift animate-slide-up`}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-line shrink-0">
          <h2 className="text-lg font-semibold truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost w-touch h-touch !min-h-0 !px-0 shrink-0"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 grow">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-line shrink-0 flex gap-3 justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Confirmation with an explicit, readable summary of what will happen. */
export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'default',
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-ink-muted leading-relaxed">{message}</div>
    </Sheet>
  );
}

export function FormRow({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="field-label">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-ink-faint mt-1.5">{hint}</p>}
      {error && <p className="text-xs text-critical mt-1.5">{error}</p>}
    </div>
  );
}

/** Tablets get more columns; a phone always gets one. */
export function ResponsiveGrid({
  children,
  min = 300,
  className = '',
}: {
  children: ReactNode;
  min?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid gap-3 ${className}`}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))` }}
    >
      {children}
    </div>
  );
}
