import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PlusIcon, RupeeIcon } from '@/components/Icons';
import {
  Card,
  EmptyState,
  ErrorState,
  FormRow,
  LoadingRows,
  Page,
  PageHeader,
  Sheet,
} from '@/components/ui';
import { api } from '@/lib/api';
import { endOfMonth, formatDate, formatMoney, startOfMonth, toInputDate } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import type { BranchSummary } from './HomeScreen';

interface Expense {
  id: string;
  title: string;
  amount: string;
  spentAt: string;
  paidTo: string | null;
  method: string;
  notes: string | null;
  branch: { name: string } | null;
  category: { id: string; name: string } | null;
}

export function ExpensesScreen() {
  const can = useAuthStore((s) => s.can);
  const branchFilter = useUiStore((s) => s.branchFilter);
  const setBranchFilter = useUiStore((s) => s.setBranchFilter);
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(endOfMonth());
  const [addOpen, setAddOpen] = useState(false);

  const { data: branches } = useQuery({
    queryKey: ['home', 'summary'],
    queryFn: () => api.get<BranchSummary[]>('/home/summary'),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['expenses', branchFilter, from, to],
    queryFn: () =>
      api.get<{ items: Expense[]; total: number; totalAmount: string }>('/expenses', {
        branchId: branchFilter ?? undefined,
        from,
        to,
        pageSize: 100,
      }),
  });

  const summary = useQuery({
    queryKey: ['expenses', 'summary', branchFilter, from, to],
    queryFn: () =>
      api.get<{
        total: string;
        count: number;
        byCategory: Array<{ name: string; total: string; count: number }>;
      }>('/expenses/summary', { from, to, branchId: branchFilter ?? undefined }),
  });

  return (
    <Page>
      <PageHeader
        title="Expenses"
        subtitle={data ? `${formatMoney(data.totalAmount)} in this period` : undefined}
        actions={
          can('expense.manage') && (
            <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
              <PlusIcon size={18} />
              <span className="hidden sm:inline">Add expense</span>
            </button>
          )
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div>
          <label className="field-label">From</label>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">To</label>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">Branch</label>
          <select
            className="input"
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
      </div>

      {summary.data && summary.data.byCategory.length > 0 && (
        <Card className="p-4 mb-5">
          <p className="stat-label mb-3">By category</p>
          <ul className="space-y-2">
            {summary.data.byCategory.map((row) => (
              <li key={row.name} className="flex items-center justify-between gap-3">
                <span className="text-sm truncate">{row.name}</span>
                <span className="tabular text-sm font-medium shrink-0">
                  {formatMoney(row.total)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={<RupeeIcon size={30} />}
          title="No expenses in this period"
          action={
            can('expense.manage') && (
              <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
                <PlusIcon size={18} />
                Add expense
              </button>
            )
          }
        />
      )}

      {data && data.items.length > 0 && (
        <Card className="divide-y divide-line">
          {data.items.map((expense) => (
            <div key={expense.id} className="p-3.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{expense.title}</p>
                <p className="text-xs text-ink-muted truncate">
                  {[
                    formatDate(expense.spentAt),
                    expense.category?.name,
                    expense.branch?.name,
                    expense.paidTo,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className="tabular font-semibold shrink-0">
                {formatMoney(expense.amount)}
              </span>
            </div>
          ))}
        </Card>
      )}

      <AddExpenseSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </Page>
  );
}

function AddExpenseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [form, setForm] = useState({
    title: '',
    amount: '',
    spentAt: toInputDate(),
    categoryId: '',
    branchId: '',
    paidTo: '',
    method: 'CASH',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  const { data: categories } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/expenses/categories'),
    enabled: open,
  });

  const { data: branches } = useQuery({
    queryKey: ['home', 'summary'],
    queryFn: () => api.get<BranchSummary[]>('/home/summary'),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/expenses', {
        title: form.title.trim(),
        amount: form.amount,
        spentAt: form.spentAt,
        categoryId: form.categoryId || undefined,
        branchId: form.branchId || undefined,
        paidTo: form.paidTo.trim() || undefined,
        method: form.method,
        notes: form.notes.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast('Expense recorded', 'success');
      setForm({ ...form, title: '', amount: '', paidTo: '', notes: '' });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not record the expense'),
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add expense"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!form.title.trim() || !form.amount || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            {create.isPending ? 'Saving…' : 'Save expense'}
          </button>
        </>
      }
    >
      <FormRow label="What was it for">
        <input
          className="input"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Vegetables for the week"
        />
      </FormRow>

      <div className="grid grid-cols-2 gap-x-4">
        <FormRow label="Amount">
          <input
            className="input tabular"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </FormRow>
        <FormRow label="Date">
          <input
            type="date"
            className="input"
            value={form.spentAt}
            onChange={(e) => setForm({ ...form, spentAt: e.target.value })}
          />
        </FormRow>
      </div>

      <FormRow label="Category">
        <select
          className="input"
          value={form.categoryId}
          onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
        >
          <option value="">Uncategorised</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormRow>

      <FormRow label="Branch">
        <select
          className="input"
          value={form.branchId}
          onChange={(e) => setForm({ ...form, branchId: e.target.value })}
        >
          <option value="">Not branch-specific</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </FormRow>

      <div className="grid grid-cols-2 gap-x-4">
        <FormRow label="Paid to">
          <input
            className="input"
            value={form.paidTo}
            onChange={(e) => setForm({ ...form, paidTo: e.target.value })}
          />
        </FormRow>
        <FormRow label="Method">
          <select
            className="input"
            value={form.method}
            onChange={(e) => setForm({ ...form, method: e.target.value })}
          >
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CARD">Card</option>
            <option value="CHEQUE">Cheque</option>
            <option value="OTHER">Other</option>
          </select>
        </FormRow>
      </div>

      {error && <p className="text-sm text-critical">{error}</p>}
    </Sheet>
  );
}
