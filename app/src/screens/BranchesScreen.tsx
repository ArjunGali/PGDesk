import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BuildingIcon, ChevronRightIcon, PlusIcon } from '@/components/Icons';
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
  Sheet,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import type { BranchSummary } from './HomeScreen';

export interface Branch {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  contact: string | null;
  description: string | null;
  status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
}

export function BranchesScreen() {
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.can);
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['home', 'summary'],
    queryFn: () => api.get<BranchSummary[]>('/home/summary'),
  });

  return (
    <Page>
      <PageHeader
        title="Branches"
        subtitle="Property structure: branches, floors, rooms and beds"
        actions={
          can('branch.manage') && (
            <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
              <PlusIcon size={18} />
              <span className="hidden sm:inline">Add branch</span>
            </button>
          )
        }
      />

      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && data.length === 0 && (
        <EmptyState
          icon={<BuildingIcon size={30} />}
          title="No branches yet"
          message="A branch holds floors, which hold rooms, which hold beds."
          action={
            can('branch.manage') && (
              <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
                <PlusIcon size={18} />
                Add your first branch
              </button>
            )
          }
        />
      )}

      {data && data.length > 0 && (
        <ResponsiveGrid min={320}>
          {data.map((branch) => (
            <Card
              key={branch.id}
              onClick={() => navigate(`/branches/${branch.id}`)}
              className="p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{branch.name}</h3>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {branch.floorCount} floors · {branch.roomCount} rooms
                  </p>
                </div>
                <ChevronRightIcon size={19} className="text-ink-faint shrink-0" />
              </div>

              <div className="flex flex-wrap gap-1.5 mt-3.5">
                <Chip tone={branch.currentVacancy > 0 ? 'positive' : 'neutral'}>
                  {branch.currentVacancy} vacant
                </Chip>
                <Chip>{branch.occupiedBeds} occupied</Chip>
                {branch.paymentPending > 0 && (
                  <Chip tone="caution">{branch.paymentPending} pending</Chip>
                )}
                {branch.status !== 'ACTIVE' && (
                  <Chip tone="critical">{branch.status.toLowerCase()}</Chip>
                )}
              </div>
            </Card>
          ))}
        </ResponsiveGrid>
      )}

      <AddBranchSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </Page>
  );
}

function AddBranchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [form, setForm] = useState({ name: '', address: '', contact: '', code: '' });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<Branch>('/branches', {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        address: form.address.trim() || undefined,
        contact: form.contact.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['home', 'summary'] });
      void queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast('Branch added', 'success');
      setForm({ name: '', address: '', contact: '', code: '' });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not add the branch'),
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add branch"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!form.name.trim() || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            {create.isPending ? 'Adding…' : 'Add branch'}
          </button>
        </>
      }
    >
      <FormRow label="Branch name">
        <input
          className="input"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Ekkatuthangal"
        />
      </FormRow>
      <FormRow label="Short code" hint="Optional. Used on bills and exports.">
        <input
          className="input"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          placeholder="EKK"
        />
      </FormRow>
      <FormRow label="Address">
        <textarea
          className="input min-h-[5rem]"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
      </FormRow>
      <FormRow label="Contact number">
        <input
          className="input"
          inputMode="tel"
          value={form.contact}
          onChange={(e) => setForm({ ...form, contact: e.target.value })}
        />
      </FormRow>
      {error && <p className="text-sm text-critical">{error}</p>}
    </Sheet>
  );
}
