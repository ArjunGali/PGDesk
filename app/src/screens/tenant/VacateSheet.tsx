import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { WarningIcon } from '@/components/Icons';
import { Field, FormRow, Sheet } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatMoney, toInputDate } from '@/lib/format';
import { useUiStore } from '@/stores/ui.store';

interface SettlementPreview {
  stayId: string;
  tenantName: string;
  checkoutDate: string;
  depositHeld: string;
  lines: Array<{
    kind: string;
    description: string;
    amount: string;
    isManual: boolean;
    reason?: string;
  }>;
  totalDeductions: string;
  netAmount: string;
  notice: {
    noticeDate: string;
    requiredUntilDate: string;
    noticeDaysRequired: number;
    shortfallDays: number;
    charge: string;
  } | null;
  warnings: string[];
}

/**
 * Vacate: notice information, the final charges, the deposit adjustment and a
 * clear refund-or-payable figure, all before anything is committed.
 */
export function VacateSheet({
  stayId,
  onClose,
}: {
  stayId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [checkoutDate, setCheckoutDate] = useState(toInputDate());
  const [reason, setReason] = useState('');
  const [finalise, setFinalise] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const open = stayId !== null;

  const { data: preview, isFetching } = useQuery({
    queryKey: ['settlement-preview', stayId, checkoutDate],
    queryFn: () =>
      api.get<SettlementPreview>(`/stays/${stayId}/settlement-preview`, { checkoutDate }),
    enabled: open && Boolean(checkoutDate),
  });

  const vacate = useMutation({
    mutationFn: () =>
      api.post(`/stays/${stayId}/vacate`, {
        checkoutDate,
        reason: reason.trim() || undefined,
        finaliseSettlement: finalise,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast('Tenant vacated and settlement recorded', 'success');
      setReason('');
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not vacate the tenant'),
  });

  const net = Number(preview?.netAmount ?? '0');

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Vacate tenant"
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={!preview || vacate.isPending}
            onClick={() => {
              setError(null);
              vacate.mutate();
            }}
          >
            {vacate.isPending ? 'Vacating…' : 'Confirm vacate'}
          </button>
        </>
      }
    >
      <FormRow label="Checkout date">
        <input
          type="date"
          className="input"
          value={checkoutDate}
          onChange={(e) => setCheckoutDate(e.target.value)}
        />
      </FormRow>

      {isFetching && !preview && <p className="text-sm text-ink-muted">Calculating…</p>}

      {preview && (
        <>
          {preview.notice && (
            <div className="card p-4 mb-4">
              <p className="stat-label mb-2">Notice period</p>
              <dl>
                <Field label="Notice given on" value={formatDate(preview.notice.noticeDate)} />
                <Field
                  label="Notice period required"
                  value={`${preview.notice.noticeDaysRequired} days`}
                />
                <Field
                  label="Required until"
                  value={formatDate(preview.notice.requiredUntilDate)}
                />
                <Field label="Actual checkout" value={formatDate(preview.checkoutDate)} />
                <Field
                  label="Remaining notice days"
                  tone={preview.notice.shortfallDays > 0 ? 'critical' : 'positive'}
                  value={
                    preview.notice.shortfallDays > 0
                      ? `${preview.notice.shortfallDays} day(s) short`
                      : 'Full notice served'
                  }
                />
              </dl>
            </div>
          )}

          <div className="card p-4 mb-4">
            <p className="stat-label mb-3">Final settlement</p>

            <div className="flex items-baseline justify-between py-2 border-b border-line">
              <span className="text-ink-muted">Deposit held</span>
              <span className="tabular font-semibold">
                {formatMoney(preview.depositHeld)}
              </span>
            </div>

            {preview.lines.map((line, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between gap-4 py-2 border-b border-line"
              >
                <span className="text-ink-muted text-sm min-w-0">
                  <span className="block truncate">{line.description}</span>
                  {line.isManual && (
                    <span className="text-xs text-caution">
                      Manual · {line.reason ?? 'no reason given'}
                    </span>
                  )}
                </span>
                <span className="tabular shrink-0">− {formatMoney(line.amount)}</span>
              </div>
            ))}

            <div className="flex items-baseline justify-between py-2 border-b border-line">
              <span className="text-ink-muted">Total deductions</span>
              <span className="tabular">− {formatMoney(preview.totalDeductions)}</span>
            </div>

            <div className="flex items-baseline justify-between pt-3.5">
              <span className="font-semibold">
                {net < 0 ? 'Amount payable by tenant' : 'Refund due to tenant'}
              </span>
              <span
                className={`text-xl font-semibold tabular ${
                  net < 0 ? 'text-critical' : 'text-positive'
                }`}
              >
                {formatMoney(Math.abs(net))}
              </span>
            </div>
          </div>

          {preview.warnings.map((warning, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 p-3 mb-3 rounded-lg bg-caution/10 border border-caution/30"
            >
              <WarningIcon size={18} className="text-caution shrink-0 mt-0.5" />
              <p className="text-sm">{warning}</p>
            </div>
          ))}
        </>
      )}

      <FormRow label="Reason / notes">
        <input
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Relocating for work"
        />
      </FormRow>

      <label className="flex items-center gap-3 min-h-touch cursor-pointer">
        <input
          type="checkbox"
          checked={finalise}
          onChange={(e) => setFinalise(e.target.checked)}
          className="w-5 h-5 accent-[rgb(var(--accent))]"
        />
        <span>
          Finalise the settlement now
          <span className="block text-xs text-ink-muted">
            Leave unticked to keep it as a draft you can adjust before closing.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-critical mt-3">{error}</p>}
    </Sheet>
  );
}
