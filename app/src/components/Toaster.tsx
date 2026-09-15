import { useUiStore } from '@/stores/ui.store';
import { CheckIcon, CloseIcon, WarningIcon } from './Icons';

export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[60] w-[min(30rem,92vw)] space-y-2 pointer-events-none"
      style={{ bottom: 'calc(6.5rem + env(safe-area-inset-bottom, 0px))' }}
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="glass border rounded-lg shadow-lift px-4 py-3 flex items-start gap-3 animate-slide-up pointer-events-auto"
        >
          <span
            className={`mt-0.5 shrink-0 ${
              toast.tone === 'error'
                ? 'text-critical'
                : toast.tone === 'success'
                  ? 'text-positive'
                  : 'text-ink-muted'
            }`}
          >
            {toast.tone === 'error' ? <WarningIcon size={19} /> : <CheckIcon size={19} />}
          </span>
          <p className="text-sm grow break-words">{toast.message}</p>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
            className="text-ink-faint hover:text-ink shrink-0"
          >
            <CloseIcon size={17} />
          </button>
        </div>
      ))}
    </div>
  );
}
