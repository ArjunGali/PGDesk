import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChartIcon, DocumentIcon } from '@/components/Icons';
import {
  Card,
  ErrorState,
  Field,
  LoadingRows,
  Page,
  PageHeader,
  ResponsiveGrid,
  Section,
} from '@/components/ui';
import { api } from '@/lib/api';
import { saveDocument } from '@/lib/download';
import { endOfMonth, formatDate, formatMoney, startOfMonth, toInputDate } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import type { BranchSummary } from './HomeScreen';

interface MonthlyReport {
  month: string;
  periodStart: string;
  periodEnd: string;
  profitAndLoss?: {
    income: {
      total: string;
      byKind: Record<string, string>;
      unattributed: string;
      paymentCount: number;
    };
    expenses: {
      total: string;
      byCategory: Array<{ name: string; total: string }>;
      count: number;
    };
    profit: string;
  };
  collections: {
    billed: string;
    collected: string;
    outstanding: string;
    expenses: string;
    net: string;
    paymentCount: number;
    invoiceCount: number;
    billedByKind: Record<string, string>;
    collectedByMethod: Record<string, string>;
  };
  occupancy: {
    periodDays: number;
    branches: Array<{
      branchId: string;
      branchName: string;
      totalBeds: number;
      occupiedBedDays: number;
      availableBedDays: number;
      occupancyRate: string;
    }>;
  };
  movements: {
    moveInCount: number;
    moveOutCount: number;
    netChange: number;
    moveIns: Array<{ stayId: string; tenantName: string; date: string; room: string | null }>;
    moveOuts: Array<{
      stayId: string;
      tenantName: string;
      date: string;
      room: string | null;
      settlementNet: string | null;
    }>;
  };
  eb: {
    totalUnits: string;
    totalAmount: string;
    cycleCount: number;
  };
}

const KIND_LABELS: Record<string, string> = {
  RENT: 'Rent',
  FOOD: 'Food',
  COMMON: 'Common charge',
  EB: 'Electricity',
  NOTICE_PERIOD: 'Notice period',
  ADJUSTMENT: 'Adjustments',
  OTHER: 'Other',
  DEPOSIT: 'Deposit',
};

export function ReportsScreen() {
  const can = useAuthStore((s) => s.can);
  const toast = useUiStore((s) => s.toast);
  const branchFilter = useUiStore((s) => s.branchFilter);
  const setBranchFilter = useUiStore((s) => s.setBranchFilter);
  const [month, setMonth] = useState(toInputDate());

  const { data: branches } = useQuery({
    queryKey: ['home', 'summary'],
    queryFn: () => api.get<BranchSummary[]>('/home/summary'),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['reports', 'monthly', month, branchFilter],
    queryFn: () =>
      api.get<MonthlyReport>('/reports/monthly', {
        month,
        branchId: branchFilter ?? undefined,
      }),
  });

  const download = async (path: string, label: string): Promise<void> => {
    try {
      toast(`Preparing ${label}…`);
      const { fileName, location } = await saveDocument(path, {
        from: startOfMonth(new Date(month)),
        to: endOfMonth(new Date(month)),
        branchId: branchFilter ?? undefined,
      });
      toast(`Saved ${fileName} to ${location}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'error');
    }
  };

  return (
    <Page>
      <PageHeader
        title="Reports"
        subtitle={data ? `${formatDate(data.periodStart)} – ${formatDate(data.periodEnd)}` : undefined}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div>
          <label className="field-label">Month</label>
          <input
            type="date"
            className="input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
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

      {can('export.run') && (
        <div className="flex flex-wrap gap-2 mb-5">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => download('/exports/collections.xlsx', 'collections workbook')}
          >
            <DocumentIcon size={18} />
            Collections (Excel)
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => download('/exports/payments.csv', 'payments CSV')}
          >
            <DocumentIcon size={18} />
            Payments (CSV)
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => download('/exports/tenants.xlsx', 'tenant register')}
          >
            <DocumentIcon size={18} />
            Tenants (Excel)
          </button>
        </div>
      )}

      {isLoading && <LoadingRows rows={4} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && (
        <>
          {data.profitAndLoss && (
          <Section title="Income, expenses and profit">
            <ResponsiveGrid min={220}>
              <StatCard
                label="Income"
                value={formatMoney(data.profitAndLoss.income.total)}
                tone="positive"
              />
              <StatCard
                label="Expenses"
                value={formatMoney(data.profitAndLoss.expenses.total)}
              />
              <StatCard
                label="Profit"
                value={formatMoney(data.profitAndLoss.profit)}
                tone={
                  Number(data.profitAndLoss.profit) < 0 ? 'critical' : 'positive'
                }
              />
            </ResponsiveGrid>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Card className="p-4">
                <p className="stat-label mb-2">Income by type</p>
                {Object.keys(data.profitAndLoss.income.byKind).length === 0 ? (
                  <p className="text-sm text-ink-muted">No money collected in this period.</p>
                ) : (
                  <dl>
                    {Object.entries(data.profitAndLoss.income.byKind).map(
                      ([kind, amount]) => (
                        <Field
                          key={kind}
                          label={KIND_LABELS[kind] ?? kind}
                          mono
                          value={formatMoney(amount)}
                        />
                      ),
                    )}
                    {Number(data.profitAndLoss.income.unattributed) > 0 && (
                      <Field
                        label="Advances not yet applied"
                        mono
                        tone="muted"
                        value={formatMoney(data.profitAndLoss.income.unattributed)}
                      />
                    )}
                  </dl>
                )}
              </Card>

              <Card className="p-4">
                <p className="stat-label mb-2">Expenses by category</p>
                {data.profitAndLoss.expenses.byCategory.length === 0 ? (
                  <p className="text-sm text-ink-muted">No expenses in this period.</p>
                ) : (
                  <dl>
                    {data.profitAndLoss.expenses.byCategory.map((row) => (
                      <Field key={row.name} label={row.name} mono value={formatMoney(row.total)} />
                    ))}
                  </dl>
                )}
              </Card>
            </div>
          </Section>
          )}

          <Section title="Billed and collected">
            <ResponsiveGrid min={220}>
              <StatCard label="Billed" value={formatMoney(data.collections.billed)} />
              <StatCard
                label="Collected"
                value={formatMoney(data.collections.collected)}
                tone="positive"
              />
              <StatCard
                label="Outstanding"
                value={formatMoney(data.collections.outstanding)}
                tone={Number(data.collections.outstanding) > 0 ? 'caution' : 'default'}
              />
              <StatCard label="Expenses" value={formatMoney(data.collections.expenses)} />
              <StatCard
                label="Net"
                value={formatMoney(data.collections.net)}
                tone={Number(data.collections.net) < 0 ? 'critical' : 'positive'}
              />
            </ResponsiveGrid>
          </Section>

          {Object.keys(data.collections.billedByKind).length > 0 && (
            <Section title="Billed by charge type">
              <Card className="p-4">
                <dl>
                  {Object.entries(data.collections.billedByKind).map(([kind, amount]) => (
                    <Field
                      key={kind}
                      label={KIND_LABELS[kind] ?? kind}
                      mono
                      value={formatMoney(amount)}
                    />
                  ))}
                </dl>
              </Card>
            </Section>
          )}

          <Section title="Occupancy">
            <Card className="p-4">
              {data.occupancy.branches.length === 0 ? (
                <p className="text-sm text-ink-muted">No branches with beds configured.</p>
              ) : (
                <ul className="space-y-3.5">
                  {data.occupancy.branches.map((branch) => (
                    <li key={branch.branchId}>
                      <div className="flex items-baseline justify-between gap-3 mb-1.5">
                        <span className="font-medium truncate">{branch.branchName}</span>
                        <span className="tabular text-sm shrink-0">
                          {branch.occupancyRate}%
                        </span>
                      </div>
                      {/* A plain bar reads faster than a chart on a phone. */}
                      <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full"
                          style={{
                            width: `${Math.min(100, Number(branch.occupancyRate))}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-ink-faint mt-1 tabular">
                        {branch.occupiedBedDays} of {branch.availableBedDays} bed-days ·{' '}
                        {branch.totalBeds} beds
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Section>

          <Section title="Movements">
            <ResponsiveGrid min={300}>
              <Card className="p-4">
                <p className="stat-label mb-2">
                  Moved in · {data.movements.moveInCount}
                </p>
                {data.movements.moveIns.length === 0 ? (
                  <p className="text-sm text-ink-muted">Nobody moved in this period.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.movements.moveIns.map((m) => (
                      <li key={m.stayId} className="py-2 flex justify-between gap-3 text-sm">
                        <span className="truncate">{m.tenantName}</span>
                        <span className="text-ink-muted shrink-0">
                          {formatDate(m.date, 'day')}
                          {m.room && ` · ${m.room}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="p-4">
                <p className="stat-label mb-2">
                  Moved out · {data.movements.moveOutCount}
                </p>
                {data.movements.moveOuts.length === 0 ? (
                  <p className="text-sm text-ink-muted">Nobody left this period.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.movements.moveOuts.map((m) => (
                      <li key={m.stayId} className="py-2 flex justify-between gap-3 text-sm">
                        <span className="truncate">{m.tenantName}</span>
                        <span className="text-ink-muted shrink-0 tabular">
                          {formatDate(m.date, 'day')}
                          {m.settlementNet !== null &&
                            ` · ${formatMoney(m.settlementNet, { sign: true })}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </ResponsiveGrid>
          </Section>

          <Section title="Electricity">
            <ResponsiveGrid min={220}>
              <StatCard label="Units billed" value={data.eb.totalUnits} />
              <StatCard label="Amount" value={formatMoney(data.eb.totalAmount)} />
              <StatCard label="Cycles" value={String(data.eb.cycleCount)} />
            </ResponsiveGrid>
          </Section>

          {data.collections.invoiceCount === 0 && (
            <Card className="p-6 text-center">
              <ChartIcon size={26} className="mx-auto text-ink-faint mb-2" />
              <p className="text-sm text-ink-muted">
                No bills were raised in this period, so most figures are zero.
              </p>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'caution' | 'critical';
}) {
  const tones = {
    default: 'text-ink',
    positive: 'text-positive',
    caution: 'text-caution',
    critical: 'text-critical',
  };
  return (
    <Card className="p-4">
      <p className="stat-label">{label}</p>
      <p className={`text-xl font-semibold tabular mt-1 ${tones[tone]}`}>{value}</p>
    </Card>
  );
}
