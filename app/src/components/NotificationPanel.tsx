import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { relativeDays } from '@/lib/format';
import { useUiStore } from '@/stores/ui.store';
import { BellIcon, CheckIcon, RefreshIcon } from './Icons';
import { Dot, EmptyState, LoadingRows, Sheet } from './ui';

interface NotificationItem {
  id: string;
  kind: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  body: string | null;
  actionPath: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
  counts: Record<string, number>;
}

const KIND_LABELS: Record<string, string> = {
  PAYMENT_PENDING: 'Payment pending',
  INCOMPLETE_PROFILE: 'Incomplete profile',
  UPCOMING_CHECKOUT: 'Upcoming checkout',
  NOTICE_EXPIRING: 'Notice period',
  DEPOSIT_REFUND_PENDING: 'Deposit refund',
  EB_READING_DUE: 'E.B. reading',
  SYSTEM: 'System',
};

function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsResponse>('/notifications'),
    // The bell should be current without hammering the server.
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
}

export function useUnreadCount(): number {
  const { data } = useNotifications();
  return data?.unreadCount ?? 0;
}

/**
 * Everything that needs attention lives here — pending payments, incomplete
 * profiles, upcoming checkouts. Home stays clean precisely because this exists.
 */
export function NotificationPanel() {
  const open = useUiStore((s) => s.notificationsOpen);
  const setOpen = useUiStore((s) => s.setNotificationsOpen);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch, isFetching } = useNotifications();

  const refresh = useMutation({
    mutationFn: () => api.post('/notifications/refresh'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post('/notifications/read', { ids: [id] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const items = data?.items ?? [];

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="Needs attention"
      footer={
        items.length > 0 ? (
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
            >
              <RefreshIcon size={18} />
              {refresh.isPending ? 'Checking…' : 'Check again'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending || (data?.unreadCount ?? 0) === 0}
            >
              <CheckIcon size={18} />
              Mark all read
            </button>
          </>
        ) : undefined
      }
    >
      {isLoading && <LoadingRows rows={4} />}
      {error && !isLoading && (
        <EmptyState
          title="Could not load notifications"
          message={error instanceof Error ? error.message : undefined}
          action={
            <button type="button" className="btn-secondary" onClick={() => refetch()}>
              Try again
            </button>
          }
        />
      )}

      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          icon={<BellIcon size={30} />}
          title="Nothing needs attention"
          message="Pending payments, incomplete profiles and upcoming checkouts will appear here."
          action={
            <button
              type="button"
              className="btn-secondary"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending || isFetching}
            >
              <RefreshIcon size={18} />
              Check again
            </button>
          }
        />
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (!item.readAt) markRead.mutate(item.id);
              if (item.actionPath) {
                setOpen(false);
                navigate(item.actionPath);
              }
            }}
            className={`w-full text-left card p-3.5 transition-colors hover:border-line-strong ${
              item.readAt ? 'opacity-70' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="mt-2 shrink-0">
                <Dot
                  tone={
                    item.severity === 'CRITICAL'
                      ? 'critical'
                      : item.severity === 'WARNING'
                        ? 'caution'
                        : 'neutral'
                  }
                />
              </span>
              <div className="min-w-0 grow">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] uppercase tracking-wider text-ink-faint">
                    {KIND_LABELS[item.kind] ?? item.kind}
                  </span>
                  <span className="text-[11px] text-ink-faint shrink-0">
                    {relativeDays(item.createdAt)}
                  </span>
                </div>
                <p className="font-medium mt-0.5 break-words">{item.title}</p>
                {item.body && (
                  <p className="text-sm text-ink-muted mt-1 break-words">{item.body}</p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
