import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BoltIcon, WarningIcon } from '@/components/Icons';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  FormRow,
  LoadingRows,
  Page,
  PageHeader,
  Sheet,
} from '@/components/ui';
import { api } from '@/lib/api';
import { endOfMonth, formatDate, formatMoney, startOfMonth } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import type { BranchSummary } from './HomeScreen';

interface Meter {
  id: string;
  name: string;
  serialNo: string | null;
  room: { id: string; name: string; floor: { name: string; branch: { name: string } } } | null;
  readings: Array<{ id: string; value: string; readingDate: string }>;
}

interface CyclePreview {
  meter: { id: string; name: string; roomName: string | null; branchName: string | null };
  periodStart: string;
  periodEnd: string;
  periodDays: number;
  startReading: { value: string; date: string } | null;
  endReading: { value: string; date: string } | null;
  unitsConsumed: string;
  ratePerUnit: string;
  totalAmount: string;
  splitMethod: string;
  warnings: string[];
  unallocatedAmount: string;
  shares: Array<{
    stayId: string;
    tenantId: string | null;
    tenantName: string;
    bedLabel: string | null;
    occupiedDays: number;
    units: string;
    amount: string;
  }>;
}

interface Cycle {
  id: string;
  periodStart: string;
  periodEnd: string;
  unitsConsumed: string;
  ratePerUnit: string;
  totalAmount: string;
  status: string;
  meter: { name: string; room: { name: string } | null };
  charges: Array<{ id: string; amount: string; stay: { tenant: { fullName: string } } }>;
}

/**
 * E.B. Calculations.
 *
 * Readings are recorded per meter, then a cycle is previewed — units, rate and
 * each tenant's share — and only finalised once it looks right. The rate is
 * copied onto the cycle at that moment, so changing it later never alters a
 * past bill.
 */
export function EbScreen() {
  const can = useAuthStore((s) => s.can);
  const branchFilter = useUiStore((s) => s.branchFilter);
  const setBranchFilter = useUiStore((s) => s.setBranchFilter);
  const [readingMeter, setReadingMeter] = useState<Meter | null>(null);
  const [calcMeter, setCalcMeter] = useState<Meter | null>(null);

  const { data: branches } = useQuery({
    queryKey: ['home', 'summary'],
    queryFn: () => api.get<BranchSummary[]>('/home/summary'),
  });

  const meters = useQuery({
    queryKey: ['eb', 'meters', branchFilter],
    queryFn: () => api.get<Meter[]>('/eb/meters', { branchId: branchFilter ?? undefined }),
  });

  const cycles = useQuery({
    queryKey: ['eb', 'cycles', branchFilter],
    queryFn: () => api.get<Cycle[]>('/eb/cycles', { branchId: branchFilter ?? undefined }),
  });

  return (
    <Page>
      <PageHeader
        title="E.B. Calculations"
        subtitle="Record meter readings, then split each cycle between the tenants of the room"
      />

      <select
        className="input sm:w-56 mb-5"
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

      {meters.isLoading && <LoadingRows rows={3} />}
      {meters.error && <ErrorState error={meters.error} onRetry={() => meters.refetch()} />}

      {meters.data && meters.data.length === 0 && (
        <EmptyState
          icon={<BoltIcon size={30} />}
          title="No meters yet"
          message="A meter is created automatically with each room. Add rooms to see them here."
        />
      )}

      {meters.data && meters.data.length > 0 && (
        <section className="mb-7">
          <h2 className="stat-label mb-2.5">Meters</h2>
          <Card className="divide-y divide-line">
            {meters.data.map((meter) => {
              const last = meter.readings[0];
              return (
                <div key={meter.id} className="p-3.5 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 grow">
                    <p className="font-medium truncate">{meter.name}</p>
                    <p className="text-xs text-ink-muted tabular">
                      {last
                        ? `Last reading ${last.value} on ${formatDate(last.readingDate)}`
                        : 'No readings recorded yet'}
                    </p>
                  </div>
                  {can('eb.manage') && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        className="btn-secondary !min-h-0 h-10 text-sm"
                        onClick={() => setReadingMeter(meter)}
                      >
                        Add reading
                      </button>
                      <button
                        type="button"
                        className="btn-primary !min-h-0 h-10 text-sm"
                        onClick={() => setCalcMeter(meter)}
                      >
                        Calculate
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        </section>
      )}

      <section>
        <h2 className="stat-label mb-2.5">Recent cycles</h2>
        {cycles.isLoading && <LoadingRows rows={2} />}
        {cycles.data && cycles.data.length === 0 && (
          <EmptyState title="No cycles finalised yet" />
        )}
        <div className="space-y-2">
          {cycles.data?.map((cycle) => (
            <Card key={cycle.id} className="p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{cycle.meter.name}</p>
                  <p className="text-xs text-ink-muted">
                    {formatDate(cycle.periodStart)} – {formatDate(cycle.periodEnd)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="tabular font-semibold">{formatMoney(cycle.totalAmount)}</p>
                  <p className="text-xs text-ink-muted tabular">
                    {cycle.unitsConsumed} units @ {formatMoney(cycle.ratePerUnit)}
                  </p>
                </div>
              </div>
              {cycle.charges.length > 0 && (
                <ul className="mt-2.5 pt-2.5 border-t border-line space-y-1">
                  {cycle.charges.map((charge) => (
                    <li
                      key={charge.id}
                      className="flex justify-between gap-3 text-sm text-ink-muted"
                    >
                      <span className="truncate">{charge.stay.tenant.fullName}</span>
                      <span className="tabular shrink-0">{formatMoney(charge.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Chip tone={cycle.status === 'FINALISED' ? 'positive' : 'neutral'}>
                {cycle.status.toLowerCase()}
              </Chip>
            </Card>
          ))}
        </div>
      </section>

      <AddReadingSheet meter={readingMeter} onClose={() => setReadingMeter(null)} />
      <CalculateSheet meter={calcMeter} onClose={() => setCalcMeter(null)} />
    </Page>
  );
}

function AddReadingSheet({ meter, onClose }: { meter: Meter | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [value, setValue] = useState('');
  const [readingDate, setReadingDate] = useState(endOfMonth());
  const [isReset, setIsReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post('/eb/readings', {
        meterId: meter?.id,
        readingDate,
        value,
        isReset,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['eb'] });
      toast('Reading recorded', 'success');
      setValue('');
      setIsReset(false);
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not record the reading'),
  });

  const last = meter?.readings[0];

  return (
    <Sheet
      open={meter !== null}
      onClose={onClose}
      title="Record meter reading"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!value || save.isPending}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending ? 'Saving…' : 'Save reading'}
          </button>
        </>
      }
    >
      {meter && (
        <>
          <p className="font-medium mb-1">{meter.name}</p>
          {last && (
            <p className="text-sm text-ink-muted mb-4 tabular">
              Previous: {last.value} on {formatDate(last.readingDate)}
            </p>
          )}

          <FormRow label="Reading date">
            <input
              type="date"
              className="input"
              value={readingDate}
              onChange={(e) => setReadingDate(e.target.value)}
            />
          </FormRow>

          <FormRow label="Meter reading">
            <input
              className="input tabular text-lg"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="1240"
            />
          </FormRow>

          <label className="flex items-start gap-3 min-h-touch cursor-pointer">
            <input
              type="checkbox"
              checked={isReset}
              onChange={(e) => setIsReset(e.target.checked)}
              className="w-5 h-5 mt-1 accent-[rgb(var(--accent))]"
            />
            <span className="text-sm">
              The meter was replaced or reset
              <span className="block text-xs text-ink-muted">
                Tick only if a new meter started from zero. Close the old meter's
                cycle first.
              </span>
            </span>
          </label>

          {error && <p className="text-sm text-critical mt-3">{error}</p>}
        </>
      )}
    </Sheet>
  );
}

function CalculateSheet({ meter, onClose }: { meter: Meter | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [periodStart, setPeriodStart] = useState(startOfMonth());
  const [periodEnd, setPeriodEnd] = useState(endOfMonth());
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['eb', 'preview', meter?.id, periodStart, periodEnd],
    queryFn: () =>
      api.get<CyclePreview>('/eb/cycles/preview', {
        meterId: meter!.id,
        periodStart,
        periodEnd,
      }),
    enabled: meter !== null && Boolean(periodStart) && Boolean(periodEnd),
    retry: false,
  });

  const finalise = useMutation({
    mutationFn: () =>
      api.post('/eb/cycles/finalise', {
        meterId: meter?.id,
        periodStart,
        periodEnd,
        acknowledgeWarnings: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['eb'] });
      toast('E.B. cycle finalised — charges will appear on the next bills', 'success');
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not finalise the cycle'),
  });

  return (
    <Sheet
      open={meter !== null}
      onClose={onClose}
      title="Calculate E.B."
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!preview.data || finalise.isPending}
            onClick={() => {
              setError(null);
              finalise.mutate();
            }}
          >
            {finalise.isPending ? 'Finalising…' : 'Finalise cycle'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4">
        <FormRow label="Period start">
          <input
            type="date"
            className="input"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </FormRow>
        <FormRow label="Period end">
          <input
            type="date"
            className="input"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        </FormRow>
      </div>

      {preview.isFetching && <p className="text-sm text-ink-muted">Calculating…</p>}
      {preview.error && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-critical/10 border border-critical/30">
          <WarningIcon size={18} className="text-critical shrink-0 mt-0.5" />
          <p className="text-sm">
            {preview.error instanceof Error ? preview.error.message : 'Could not calculate'}
          </p>
        </div>
      )}

      {preview.data && (
        <>
          <Card className="p-4 my-4">
            <dl>
              <Field
                label="Opening reading"
                mono
                value={
                  preview.data.startReading
                    ? `${preview.data.startReading.value} (${formatDate(preview.data.startReading.date)})`
                    : 'None'
                }
              />
              <Field
                label="Closing reading"
                mono
                value={
                  preview.data.endReading
                    ? `${preview.data.endReading.value} (${formatDate(preview.data.endReading.date)})`
                    : 'None'
                }
              />
              <Field label="Units consumed" mono value={preview.data.unitsConsumed} />
              <Field label="Rate per unit" mono value={formatMoney(preview.data.ratePerUnit)} />
              <Field
                label="Total"
                mono
                value={
                  <span className="text-lg font-semibold">
                    {formatMoney(preview.data.totalAmount)}
                  </span>
                }
              />
              <Field
                label="Split method"
                value={
                  preview.data.splitMethod === 'OCCUPIED_DAYS'
                    ? 'By days each tenant occupied a bed'
                    : 'Equally between tenants present'
                }
              />
            </dl>
          </Card>

          {preview.data.warnings.map((warning, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 p-3 mb-3 rounded-lg bg-caution/10 border border-caution/30"
            >
              <WarningIcon size={18} className="text-caution shrink-0 mt-0.5" />
              <p className="text-sm">{warning}</p>
            </div>
          ))}

          <p className="stat-label mb-2">Each tenant's share</p>
          {preview.data.shares.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Nobody occupied this room during the period.
            </p>
          ) : (
            <Card className="divide-y divide-line">
              {preview.data.shares.map((share) => (
                <div
                  key={share.stayId}
                  className="p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{share.tenantName}</p>
                    <p className="text-xs text-ink-muted tabular">
                      {share.occupiedDays} day{share.occupiedDays === 1 ? '' : 's'} ·{' '}
                      {share.units} units
                      {share.bedLabel && ` · bed ${share.bedLabel}`}
                    </p>
                  </div>
                  <span className="tabular font-semibold shrink-0">
                    {formatMoney(share.amount)}
                  </span>
                </div>
              ))}
            </Card>
          )}

          <p className="text-xs text-ink-faint mt-3">
            Finalising copies today's rate onto this cycle. Changing the rate later
            will not alter it.
          </p>
        </>
      )}

      {error && <p className="text-sm text-critical mt-3">{error}</p>}
    </Sheet>
  );
}
