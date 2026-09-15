import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WalletIcon } from '@/components/Icons';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FormRow,
  LoadingRows,
  Page,
  PageHeader,
  ResponsiveGrid,
  Section,
  Sheet,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatMoney, toInputDate } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import type { BranchSummary } from './HomeScreen';

interface PendingItem {
  stayId: string;
  tenantId: string;
  tenantName: string;
  mobile: string | null;
  branchName: string | null;
  roomName: string | null;
  bedLabel: string | null;
  balance: string;
  oldestDueDate: string;
  invoiceCount: number;
  daysOverdue: number;
}

interface PendingResponse {
  totalOutstanding: string;
  count: number;
  items: PendingItem[];
}

interface PaymentRow {
  id: string;
  receiptNo: string;
  amount: string;
  method: string;
  paidAt: string;
  reversedAt: string | null;
  stay: { tenant: { id: string; fullName: string } };
  allocations: Array<{ invoice: { number: string } }>;
}

export function PaymentsScreen() {
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.can);
  const branchFilter = useUiStore((s) => s.branchFilter);
  const setBranchFilter = useUiStore((s) => s.setBranchFilter);
  const [tab, setTab] = useState<'pending' | 'received'>('pending');
  const [collectFrom, setCollectFrom] = useState<PendingItem | null>(null);

  const { data: branches } = useQuery({
    queryKey: ['home', 'summary'],
    queryFn: () => api.get<BranchSummary[]>('/home/summary'),
  });

  const pending = useQuery({
    queryKey: ['payments', 'pending', branchFilter],
    queryFn: () =>
      api.get<PendingResponse>('/payments/pending', {
        branchId: branchFilter ?? undefined,
      }),
    enabled: tab === 'pending',
  });

  const received = useQuery({
    queryKey: ['payments', 'received', branchFilter],
    queryFn: () =>
      api.get<{ items: PaymentRow[]; totalAmount: string }>('/payments', {
        branchId: branchFilter ?? undefined,
        pageSize: 50,
      }),
    enabled: tab === 'received',
  });

  return (
    <Page>
      <PageHeader
        title="Payments"
        subtitle={
          tab === 'pending' && pending.data
            ? `${formatMoney(pending.data.totalOutstanding)} outstanding from ${
                pending.data.count
              } tenant${pending.data.count === 1 ? '' : 's'}`
            : undefined
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex gap-1 border border-line rounded-lg p-1 bg-surface-sunken">
          {(['pending', 'received'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-4 h-10 rounded-md text-sm font-medium transition-colors ${
                tab === key ? 'bg-surface-raised text-ink' : 'text-ink-muted'
              }`}
            >
              {key === 'pending' ? 'Pending' : 'Received'}
            </button>
          ))}
        </div>
        <select
          className="input sm:w-56"
          value={branchFilter ?? ''}
          onChange={(e) => setBranchFilter(e.target.value || null)}
        >
          <option value="">All branches</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {tab === 'pending' && (
        <>
          {pending.isLoading && <LoadingRows rows={3} />}
          {pending.error && (
            <ErrorState error={pending.error} onRetry={() => pending.refetch()} />
          )}
          {pending.data && pending.data.items.length === 0 && (
            <EmptyState
              icon={<WalletIcon size={30} />}
              title="Everything is paid up"
              message="No tenant has an outstanding balance right now."
            />
          )}
          {pending.data && pending.data.items.length > 0 && (
            <ResponsiveGrid min={320}>
              {pending.data.items.map((item) => (
                <Card key={item.stayId} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => navigate(`/tenants/${item.tenantId}`)}
                      className="min-w-0 text-left"
                    >
                      <h3 className="font-semibold truncate">{item.tenantName}</h3>
                      <p className="text-xs text-ink-muted truncate">
                        {[item.branchName, item.roomName && `Room ${item.roomName}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </button>
                    <Chip tone={item.daysOverdue > 15 ? 'critical' : 'caution'}>
                      {item.daysOverdue > 0 ? `${item.daysOverdue}d overdue` : 'Due'}
                    </Chip>
                  </div>

                  <div className="flex items-end justify-between gap-3 mt-3.5">
                    <div>
                      <p className="stat-label">Outstanding</p>
                      <p className="text-xl font-semibold tabular text-caution">
                        {formatMoney(item.balance)}
                      </p>
                      <p className="text-xs text-ink-faint mt-0.5">
                        {item.invoiceCount} bill{item.invoiceCount === 1 ? '' : 's'} · oldest due{' '}
                        {formatDate(item.oldestDueDate)}
                      </p>
                    </div>
                    {can('payment.record') && (
                      <button
                        type="button"
                        className="btn-primary shrink-0"
                        onClick={() => setCollectFrom(item)}
                      >
                        Collect
                      </button>
                    )}
                  </div>
                </Card>
              ))}
            </ResponsiveGrid>
          )}
        </>
      )}

      {tab === 'received' && (
        <>
          {received.isLoading && <LoadingRows rows={3} />}
          {received.error && (
            <ErrorState error={received.error} onRetry={() => received.refetch()} />
          )}
          {received.data && received.data.items.length === 0 && (
            <EmptyState title="No payments recorded yet" />
          )}
          {received.data && received.data.items.length > 0 && (
            <Section title={`Recent payments · ${formatMoney(received.data.totalAmount)}`}>
              <Card className="divide-y divide-line">
                {received.data.items.map((payment) => (
                  <button
                    key={payment.id}
                    type="button"
                    onClick={() => navigate(`/tenants/${payment.stay.tenant.id}`)}
                    className="w-full text-left p-3.5 flex items-center justify-between gap-3 hover:bg-surface-raised transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{payment.stay.tenant.fullName}</p>
                      <p className="text-xs text-ink-muted truncate">
                        {payment.receiptNo} · {formatDate(payment.paidAt)} ·{' '}
                        {payment.method.replace('_', ' ')}
                        {payment.allocations.length > 0 &&
                          ` · ${payment.allocations.map((a) => a.invoice.number).join(', ')}`}
                      </p>
                    </div>
                    <span
                      className={`tabular font-semibold shrink-0 ${
                        payment.reversedAt ? 'line-through text-ink-faint' : 'text-positive'
                      }`}
                    >
                      {formatMoney(payment.amount)}
                    </span>
                  </button>
                ))}
              </Card>
            </Section>
          )}
        </>
      )}

      <CollectSheet item={collectFrom} onClose={() => setCollectFrom(null)} />
    </Page>
  );
}

function CollectSheet({
  item,
  onClose,
}: {
  item: PendingItem | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [paidAt, setPaidAt] = useState(toInputDate());
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: () =>
      api.post<{ allocations: Array<{ number: string; amount: string }>; unallocated: string }>(
        '/payments',
        {
          stayId: item?.stayId,
          amount: amount || item?.balance,
          method,
          paidAt,
          reference: reference.trim() || undefined,
        },
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      const extra =
        Number(result.unallocated) > 0
          ? ` ${formatMoney(result.unallocated)} held as advance.`
          : '';
      toast(`Payment recorded.${extra}`, 'success');
      setAmount('');
      setReference('');
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not record the payment'),
  });

  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      title="Record payment"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={record.isPending}
            onClick={() => {
              setError(null);
              record.mutate();
            }}
          >
            {record.isPending ? 'Recording…' : 'Record payment'}
          </button>
        </>
      }
    >
      {item && (
        <>
          <div className="card p-3.5 mb-4">
            <p className="font-medium">{item.tenantName}</p>
            <p className="text-sm text-ink-muted">
              Outstanding {formatMoney(item.balance)} across {item.invoiceCount} bill
              {item.invoiceCount === 1 ? '' : 's'}
            </p>
          </div>

          <FormRow
            label="Amount"
            hint="Leave blank to settle the full outstanding amount. Money is applied to the oldest bills first."
          >
            <input
              className="input tabular"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={item.balance}
            />
          </FormRow>

          <FormRow label="Method">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CARD">Card</option>
              <option value="CHEQUE">Cheque</option>
              <option value="OTHER">Other</option>
            </select>
          </FormRow>

          <FormRow label="Date received">
            <input
              type="date"
              className="input"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </FormRow>

          <FormRow label="Reference" hint="UPI reference, cheque number, and so on.">
            <input
              className="input"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </FormRow>

          {error && <p className="text-sm text-critical">{error}</p>}
        </>
      )}
    </Sheet>
  );
}
