import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormRow, Sheet } from '@/components/ui';
import { api } from '@/lib/api';
import { toInputDate } from '@/lib/format';
import { useUiStore } from '@/stores/ui.store';

interface VacantBed {
  branchName: string;
  floorName: string;
  roomName: string;
  bedId: string;
  bedLabel: string;
  capacity: number;
  acType: string;
}

/**
 * Creating a tenant and starting their stay in one pass.
 *
 * Only the name is required. Everything else can be filled in later — an
 * incomplete profile is saved and flagged under the bell rather than blocked,
 * because a tenant arriving at the door should not wait on paperwork.
 */
export function AddTenantSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    fullName: '',
    mobile: '',
    emergencyContact: '',
    permanentAddress: '',
    officeName: '',
    stayType: 'MONTHLY',
    checkInDate: toInputDate(),
    plannedDays: '',
    foodIncluded: true,
    bedId: '',
    depositAmount: '',
    depositCollected: '',
    customRent: '',
  });

  const { data: vacancy } = useQuery({
    queryKey: ['vacancy', 'all'],
    queryFn: () => api.get<{ available: VacantBed[] }>('/vacancy'),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: async () => {
      const tenant = await api.post<{ id: string }>('/tenants', {
        fullName: form.fullName.trim(),
        mobile: form.mobile.trim() || undefined,
        emergencyContact: form.emergencyContact.trim() || undefined,
        permanentAddress: form.permanentAddress.trim() || undefined,
        officeName: form.officeName.trim() || undefined,
      });

      await api.post(`/tenants/${tenant.id}/stays`, {
        stayType: form.stayType,
        checkInDate: form.checkInDate,
        plannedDays: form.plannedDays ? Number(form.plannedDays) : undefined,
        // Daily stays never carry food; the server enforces this too.
        foodIncluded: form.stayType === 'DAILY' ? false : form.foodIncluded,
        bedId: form.bedId || undefined,
        depositAmount: form.depositAmount || undefined,
        depositCollected: form.depositCollected || undefined,
        customRent: form.customRent || undefined,
        customRentReason: form.customRent ? 'Agreed at check-in' : undefined,
      });

      return tenant;
    },
    onSuccess: (tenant) => {
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
      void queryClient.invalidateQueries({ queryKey: ['home', 'summary'] });
      void queryClient.invalidateQueries({ queryKey: ['vacancy'] });
      toast('Tenant added', 'success');
      onClose();
      navigate(`/tenants/${tenant.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not add the tenant'),
  });

  const isDaily = form.stayType === 'DAILY';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add tenant"
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!form.fullName.trim() || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            {create.isPending ? 'Saving…' : 'Save tenant'}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-muted mb-5">
        Only the name is needed now. Anything left blank is flagged under the bell
        so it can be completed later.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <FormRow label="Full name">
          <input
            className="input"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            autoCapitalize="words"
          />
        </FormRow>
        <FormRow label="Mobile">
          <input
            className="input"
            inputMode="tel"
            value={form.mobile}
            onChange={(e) => setForm({ ...form, mobile: e.target.value })}
          />
        </FormRow>
        <FormRow label="Emergency contact">
          <input
            className="input"
            inputMode="tel"
            value={form.emergencyContact}
            onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
          />
        </FormRow>
        <FormRow label="Office / college">
          <input
            className="input"
            value={form.officeName}
            onChange={(e) => setForm({ ...form, officeName: e.target.value })}
          />
        </FormRow>
      </div>

      <FormRow label="Permanent address">
        <textarea
          className="input min-h-[4.5rem]"
          value={form.permanentAddress}
          onChange={(e) => setForm({ ...form, permanentAddress: e.target.value })}
        />
      </FormRow>

      <hr className="border-line my-5" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <FormRow label="Stay type">
          <select
            className="input"
            value={form.stayType}
            onChange={(e) => setForm({ ...form, stayType: e.target.value })}
          >
            <option value="MONTHLY">Monthly</option>
            <option value="DAILY">Daily</option>
          </select>
        </FormRow>

        <FormRow label="Check-in date">
          <input
            type="date"
            className="input"
            value={form.checkInDate}
            onChange={(e) => setForm({ ...form, checkInDate: e.target.value })}
          />
        </FormRow>

        {isDaily && (
          <FormRow label="Number of days">
            <input
              className="input"
              inputMode="numeric"
              value={form.plannedDays}
              onChange={(e) => setForm({ ...form, plannedDays: e.target.value })}
            />
          </FormRow>
        )}

        <FormRow label="Bed" hint="Only vacant beds are listed.">
          <select
            className="input"
            value={form.bedId}
            onChange={(e) => setForm({ ...form, bedId: e.target.value })}
          >
            <option value="">Assign later</option>
            {vacancy?.available.map((bed) => (
              <option key={bed.bedId} value={bed.bedId}>
                {bed.branchName} · {bed.roomName} · Bed {bed.bedLabel} ({bed.capacity} sharing{' '}
                {bed.acType === 'AC' ? 'AC' : 'Non-AC'})
              </option>
            ))}
          </select>
        </FormRow>
      </div>

      {!isDaily && (
        <label className="flex items-center gap-3 min-h-touch cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={form.foodIncluded}
            onChange={(e) => setForm({ ...form, foodIncluded: e.target.checked })}
            className="w-5 h-5 accent-[rgb(var(--accent))]"
          />
          <span>
            Food included
            <span className="block text-xs text-ink-muted">
              Room rents are stored inclusive of food; without it the configured
              food difference is deducted.
            </span>
          </span>
        </label>
      )}

      {isDaily && (
        <p className="text-sm text-ink-muted mb-4">
          Daily stays are billed per day and never include food.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <FormRow label="Deposit agreed">
          <input
            className="input tabular"
            inputMode="decimal"
            value={form.depositAmount}
            onChange={(e) => setForm({ ...form, depositAmount: e.target.value })}
            placeholder="10000"
          />
        </FormRow>
        <FormRow label="Deposit collected now" hint="Recorded in the deposit ledger.">
          <input
            className="input tabular"
            inputMode="decimal"
            value={form.depositCollected}
            onChange={(e) => setForm({ ...form, depositCollected: e.target.value })}
          />
        </FormRow>
      </div>

      <FormRow
        label="Custom rent for this tenant"
        hint="Optional. Overrides the room price for this tenant only, from the check-in date."
      >
        <input
          className="input tabular"
          inputMode="decimal"
          value={form.customRent}
          onChange={(e) => setForm({ ...form, customRent: e.target.value })}
        />
      </FormRow>

      {error && <p className="text-sm text-critical">{error}</p>}
    </Sheet>
  );
}
