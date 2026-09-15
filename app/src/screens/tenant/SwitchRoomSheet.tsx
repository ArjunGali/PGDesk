import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SwapIcon, WarningIcon } from '@/components/Icons';
import { Field, FormRow, Sheet } from '@/components/ui';
import { api } from '@/lib/api';
import { describeSharing, formatMoney, toInputDate } from '@/lib/format';
import { useUiStore } from '@/stores/ui.store';

interface SwitchPreview {
  effectiveDate: string;
  tenant: { id: string; name: string };
  from: {
    branchName: string;
    floorName: string;
    roomName: string;
    bedLabel: string;
    capacity: number;
    acType: string;
    monthlyRent: string | null;
  } | null;
  to: {
    branchName: string;
    floorName: string;
    roomName: string;
    bedLabel: string;
    capacity: number;
    acType: string;
    monthlyRent: string;
  };
  rentDifference: string;
  foodIncluded: boolean;
  requiresSwap: boolean;
  swapWith: { stayId: string; tenantId: string; tenantName: string } | null;
  crossBranch: boolean;
}

interface BedOption {
  branchName: string;
  floorName: string;
  roomName: string;
  bedId: string;
  bedLabel: string;
  capacity: number;
  acType: string;
  occupiedBy?: string;
}

/**
 * Switch Room — including to another floor or another branch, and swapping
 * with the current occupant when the destination is full.
 *
 * Nothing is applied until the full consequences are shown and confirmed.
 */
export function SwitchRoomSheet({
  stayId,
  onClose,
}: {
  stayId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [toBedId, setToBedId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(toInputDate());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = stayId !== null;

  // Both free beds and occupied ones: an occupied bed is a swap candidate.
  const { data: vacancy } = useQuery({
    queryKey: ['vacancy', 'switch'],
    queryFn: () =>
      api.get<{ available: BedOption[]; upcoming: BedOption[] }>('/vacancy', {
        upcomingDays: 60,
      }),
    enabled: open,
  });

  const { data: preview, isFetching: previewing } = useQuery({
    queryKey: ['switch-preview', stayId, toBedId, effectiveDate],
    queryFn: () =>
      api.get<SwitchPreview>(`/stays/${stayId}/switch-preview`, {
        toBedId,
        effectiveDate,
      }),
    enabled: open && Boolean(toBedId) && Boolean(effectiveDate),
  });

  const apply = useMutation({
    mutationFn: () =>
      api.post(`/stays/${stayId}/switch-room`, {
        toBedId,
        effectiveDate,
        reason: reason.trim() || undefined,
        allowSwap: preview?.requiresSwap ?? false,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast(preview?.requiresSwap ? 'Tenants swapped' : 'Room switched', 'success');
      reset();
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not switch the room'),
  });

  const reset = (): void => {
    setToBedId('');
    setReason('');
    setError(null);
    setEffectiveDate(toInputDate());
  };

  const difference = Number(preview?.rentDifference ?? '0');

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Switch room"
      wide
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!preview || apply.isPending}
            onClick={() => {
              setError(null);
              apply.mutate();
            }}
          >
            {apply.isPending
              ? 'Moving…'
              : preview?.requiresSwap
                ? 'Confirm swap'
                : 'Confirm move'}
          </button>
        </>
      }
    >
      <FormRow label="Move to">
        <select className="input" value={toBedId} onChange={(e) => setToBedId(e.target.value)}>
          <option value="">Choose a bed</option>
          {vacancy && vacancy.available.length > 0 && (
            <optgroup label="Free now">
              {vacancy.available.map((bed) => (
                <option key={bed.bedId} value={bed.bedId}>
                  {bed.branchName} · {bed.roomName} · Bed {bed.bedLabel} (
                  {describeSharing(bed.capacity, bed.acType)})
                </option>
              ))}
            </optgroup>
          )}
          {vacancy && vacancy.upcoming.length > 0 && (
            <optgroup label="Occupied — moving here swaps the two tenants">
              {vacancy.upcoming.map((bed) => (
                <option key={bed.bedId} value={bed.bedId}>
                  {bed.branchName} · {bed.roomName} · Bed {bed.bedLabel} — {bed.occupiedBy}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </FormRow>

      <FormRow label="Effective from">
        <input
          type="date"
          className="input"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
        />
      </FormRow>

      {previewing && <p className="text-sm text-ink-muted">Checking…</p>}

      {preview && (
        <div className="card p-4 my-4">
          <p className="stat-label mb-3">Confirm the move</p>

          <dl>
            <Field label="Tenant" value={preview.tenant.name} />
            <Field
              label="Current room"
              value={
                preview.from
                  ? `${preview.from.branchName} · ${preview.from.floorName} · ${preview.from.roomName} · Bed ${preview.from.bedLabel}`
                  : 'Not currently assigned'
              }
            />
            <Field
              label="New room"
              value={`${preview.to.branchName} · ${preview.to.floorName} · ${preview.to.roomName} · Bed ${preview.to.bedLabel}`}
            />
            <Field
              label="Rent"
              value={
                <span className="tabular">
                  {preview.from?.monthlyRent
                    ? `${formatMoney(preview.from.monthlyRent)} → `
                    : ''}
                  {formatMoney(preview.to.monthlyRent)}
                </span>
              }
            />
            <Field
              label="Rent difference"
              mono
              tone={difference > 0 ? 'critical' : difference < 0 ? 'positive' : 'muted'}
              value={
                difference === 0
                  ? 'No change'
                  : `${formatMoney(preview.rentDifference, { sign: true })} per month`
              }
            />
            <Field
              label="Food status"
              value={preview.foodIncluded ? 'Included — unchanged' : 'Not included — unchanged'}
            />
            <Field label="Effective date" value={new Date(preview.effectiveDate).toDateString()} />
          </dl>

          {preview.requiresSwap && preview.swapWith && (
            <div className="mt-3 p-3 rounded-lg bg-caution/10 border border-caution/30 flex items-start gap-2.5">
              <SwapIcon size={18} className="text-caution shrink-0 mt-0.5" />
              <p className="text-sm">
                <span className="font-medium">{preview.swapWith.tenantName}</span> is in that
                bed. Confirming swaps the two tenants: they move into{' '}
                {preview.from?.roomName ?? 'the current room'} on the same date.
              </p>
            </div>
          )}

          {preview.crossBranch && (
            <div className="mt-3 p-3 rounded-lg bg-surface-sunken border border-line flex items-start gap-2.5">
              <WarningIcon size={18} className="text-ink-muted shrink-0 mt-0.5" />
              <p className="text-sm text-ink-muted">
                This move crosses branches. The room history keeps both branches.
              </p>
            </div>
          )}
        </div>
      )}

      <FormRow label="Reason" hint="Optional, but it is kept in the room history.">
        <input
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Tenant requested an upgrade"
        />
      </FormRow>

      {error && <p className="text-sm text-critical">{error}</p>}
    </Sheet>
  );
}
