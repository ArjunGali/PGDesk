import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CheckIcon, PlusIcon, SettingsIcon } from '@/components/Icons';
import {
  Card,
  Chip,
  ErrorState,
  Field,
  FormRow,
  LoadingRows,
  Page,
  PageHeader,
  Section,
  Sheet,
} from '@/components/ui';
import { api, getBaseUrl, setBaseUrl } from '@/lib/api';
import { formatDate, formatMoney, toInputDate } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import type { BranchSummary } from './HomeScreen';

interface Setting {
  key: string;
  value: string;
  type: 'STRING' | 'NUMBER' | 'MONEY' | 'INTEGER' | 'BOOLEAN' | 'JSON';
  group: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  options: string[] | null;
}

interface PricingRule {
  id: string;
  scope: string;
  capacity: number | null;
  acType: string | null;
  variant: string | null;
  amountWithFood: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  branch: { id: string; name: string } | null;
  room: { id: string; name: string } | null;
}

const GROUP_LABELS: Record<string, string> = {
  general: 'General',
  pricing: 'Pricing',
  charges: 'Charges',
  eb: 'Electricity',
  stay: 'Stays and notice',
  billing: 'Billing',
  notifications: 'Notifications',
  tenant: 'Tenant profiles',
};

/**
 * Settings is where the business runs from.
 *
 * Every value here is read by the backend at the moment it is needed —
 * nothing is compiled in. Changing the E.B. rate, the common charge, the food
 * difference or the notice period affects future calculations only; anything
 * already billed keeps the values it was billed with.
 */
export function SettingsScreen() {
  const can = useAuthStore((s) => s.can);
  const [tab, setTab] = useState<'values' | 'pricing' | 'server'>('values');

  return (
    <Page>
      <PageHeader title="Settings" subtitle="Everything the business runs on, kept out of the code" />

      <div className="flex gap-1 border-b border-line mb-5 overflow-x-auto">
        {(
          [
            ['values', 'Values'],
            ['pricing', 'Pricing'],
            ['server', 'App & server'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 min-h-touch font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'values' && <ValuesTab canEdit={can('settings.manage')} />}
      {tab === 'pricing' && <PricingTab canEdit={can('pricing.manage')} />}
      {tab === 'server' && <ServerTab />}
    </Page>
  );
}

function ValuesTab({ canEdit }: { canEdit: boolean }) {
  const [editing, setEditing] = useState<Setting | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Setting[]>('/settings'),
  });

  if (isLoading) return <LoadingRows rows={4} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const groups = new Map<string, Setting[]>();
  for (const setting of data ?? []) {
    const list = groups.get(setting.group) ?? [];
    list.push(setting);
    groups.set(setting.group, list);
  }

  return (
    <>
      {[...groups.entries()].map(([group, settings]) => (
        <Section key={group} title={GROUP_LABELS[group] ?? group}>
          <Card className="divide-y divide-line">
            {settings.map((setting) => (
              <button
                key={setting.key}
                type="button"
                disabled={!canEdit}
                onClick={() => setEditing(setting)}
                className="w-full text-left p-3.5 flex items-start justify-between gap-4
                           hover:bg-surface-raised transition-colors disabled:hover:bg-transparent"
              >
                <div className="min-w-0">
                  <p className="font-medium">{setting.label}</p>
                  {setting.description && (
                    <p className="text-xs text-ink-muted mt-0.5">{setting.description}</p>
                  )}
                </div>
                <span className="tabular font-semibold shrink-0">
                  {formatSettingValue(setting)}
                </span>
              </button>
            ))}
          </Card>
        </Section>
      ))}

      <EditSettingSheet setting={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function formatSettingValue(setting: Setting): string {
  if (setting.type === 'MONEY') return formatMoney(setting.value);
  if (setting.type === 'BOOLEAN') return setting.value === 'true' ? 'On' : 'Off';
  if (setting.type === 'JSON') {
    try {
      const parsed: unknown = JSON.parse(setting.value);
      if (Array.isArray(parsed)) return `${parsed.length} field(s)`;
    } catch {
      /* fall through and show the raw value */
    }
  }
  // Enum-style settings are stored as ACTUAL_DAYS but should read as words.
  if (setting.options) return humanise(setting.value);
  return setting.value;
}

function humanise(value: string): string {
  const words = value.toLowerCase().split('_');
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

function EditSettingSheet({
  setting,
  onClose,
}: {
  setting: Setting | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const current = touched ? value : (setting?.value ?? '');

  const { data: history } = useQuery({
    queryKey: ['settings', setting?.key, 'history'],
    queryFn: () =>
      api.get<
        Array<{
          id: string;
          oldValue: string | null;
          newValue: string;
          effectiveAt: string;
          reason: string | null;
          changedBy: { fullName: string } | null;
        }>
      >(`/settings/${setting!.key}/history`),
    enabled: setting !== null,
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/settings/${setting?.key}`, {
        value: current,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast('Setting updated — it applies to future calculations', 'success');
      setTouched(false);
      setReason('');
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save'),
  });

  return (
    <Sheet
      open={setting !== null}
      onClose={() => {
        setTouched(false);
        setError(null);
        onClose();
      }}
      title={setting?.label ?? 'Setting'}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!touched || save.isPending}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {setting && (
        <>
          {setting.description && (
            <p className="text-sm text-ink-muted mb-4">{setting.description}</p>
          )}

          <FormRow label="Value">
            {setting.options ? (
              <select
                className="input"
                value={current}
                onChange={(e) => {
                  setValue(e.target.value);
                  setTouched(true);
                }}
              >
                {setting.options.map((option) => (
                  <option key={option} value={option}>
                    {humanise(option)}
                  </option>
                ))}
              </select>
            ) : setting.type === 'BOOLEAN' ? (
              <select
                className="input"
                value={current}
                onChange={(e) => {
                  setValue(e.target.value);
                  setTouched(true);
                }}
              >
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            ) : setting.type === 'JSON' ? (
              <textarea
                className="input min-h-[6rem] font-mono text-sm"
                value={current}
                onChange={(e) => {
                  setValue(e.target.value);
                  setTouched(true);
                }}
              />
            ) : (
              <input
                className={`input ${
                  setting.type === 'MONEY' || setting.type === 'NUMBER' ? 'tabular' : ''
                }`}
                inputMode={
                  setting.type === 'MONEY' || setting.type === 'NUMBER'
                    ? 'decimal'
                    : setting.type === 'INTEGER'
                      ? 'numeric'
                      : 'text'
                }
                value={current}
                onChange={(e) => {
                  setValue(e.target.value);
                  setTouched(true);
                }}
              />
            )}
          </FormRow>

          <FormRow label="Reason for the change" hint="Kept with the setting's history.">
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="EB tariff revised"
            />
          </FormRow>

          <p className="text-xs text-ink-faint mb-4">
            Changing this affects future calculations only. Bills, E.B. cycles and
            settlements already recorded keep the values they were produced with.
          </p>

          {history && history.length > 0 && (
            <>
              <p className="stat-label mb-2">History</p>
              <ul className="divide-y divide-line">
                {history.map((entry) => (
                  <li key={entry.id} className="py-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="tabular">
                        {entry.oldValue ?? '—'} → {entry.newValue}
                      </span>
                      <span className="text-ink-muted shrink-0 text-xs">
                        {formatDate(entry.effectiveAt)}
                      </span>
                    </div>
                    {(entry.reason || entry.changedBy) && (
                      <p className="text-xs text-ink-faint mt-0.5">
                        {[entry.changedBy?.fullName, entry.reason]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {error && <p className="text-sm text-critical mt-3">{error}</p>}
        </>
      )}
    </Sheet>
  );
}

function PricingTab({ canEdit }: { canEdit: boolean }) {
  const [branchId, setBranchId] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const { data: branches } = useQuery({
    queryKey: ['home', 'summary'],
    queryFn: () => api.get<BranchSummary[]>('/home/summary'),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pricing', 'rules', branchId],
    queryFn: () =>
      api.get<PricingRule[]>('/pricing/rules', { branchId: branchId || undefined }),
  });

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <select
          className="input grow"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
        >
          <option value="">All branches</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {canEdit && (
          <button type="button" className="btn-primary shrink-0" onClick={() => setAddOpen(true)}>
            <PlusIcon size={18} />
            Add price
          </button>
        )}
      </div>

      <p className="text-sm text-ink-muted mb-4">
        The most specific price that applies wins: a tenant price beats a room
        price, which beats a sharing price, which beats a branch or global one.
        Prices include food; a tenant without food pays this minus the configured
        food difference.
      </p>

      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && data.length === 0 && (
        <Card className="p-8 text-center">
          <SettingsIcon size={26} className="mx-auto text-ink-faint mb-2" />
          <p className="text-ink-muted">No pricing rules configured yet.</p>
        </Card>
      )}

      {data && data.length > 0 && (
        <Card className="divide-y divide-line">
          {data.map((rule) => (
            <div key={rule.id} className="p-3.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {rule.capacity ? `${rule.capacity} sharing` : 'Any sharing'}
                  {rule.acType && ` · ${rule.acType === 'AC' ? 'AC' : 'Non-AC'}`}
                  {rule.variant && ` · ${rule.variant}`}
                </p>
                <p className="text-xs text-ink-muted">
                  {[
                    rule.branch?.name,
                    rule.room?.name && `Room ${rule.room.name}`,
                    `from ${formatDate(rule.effectiveFrom)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {rule.reason && (
                  <p className="text-xs text-ink-faint mt-0.5">{rule.reason}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="tabular font-semibold">{formatMoney(rule.amountWithFood)}</p>
                <Chip>{rule.scope.toLowerCase()}</Chip>
              </div>
            </div>
          ))}
        </Card>
      )}

      <AddPriceSheet open={addOpen} onClose={() => setAddOpen(false)} branches={branches ?? []} />
    </>
  );
}

function AddPriceSheet({
  open,
  onClose,
  branches,
}: {
  open: boolean;
  onClose: () => void;
  branches: BranchSummary[];
}) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [form, setForm] = useState({
    branchId: '',
    capacity: '3',
    acType: 'AC',
    variant: '',
    amountWithFood: '',
    effectiveFrom: toInputDate(),
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post('/pricing/rules', {
        scope: 'SHARING',
        branchId: form.branchId,
        capacity: Number(form.capacity),
        acType: form.acType,
        variant: form.variant.trim() || undefined,
        amountWithFood: form.amountWithFood,
        effectiveFrom: form.effectiveFrom,
        reason: form.reason.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pricing'] });
      toast('Price added', 'success');
      setForm({ ...form, amountWithFood: '', reason: '' });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not add the price'),
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add sharing price"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!form.branchId || !form.amountWithFood || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            {create.isPending ? 'Saving…' : 'Add price'}
          </button>
        </>
      }
    >
      <FormRow label="Branch">
        <select
          className="input"
          value={form.branchId}
          onChange={(e) => setForm({ ...form, branchId: e.target.value })}
        >
          <option value="">Choose a branch</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </FormRow>

      <div className="grid grid-cols-2 gap-x-4">
        <FormRow label="Sharing">
          <select
            className="input"
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n} sharing
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Type">
          <select
            className="input"
            value={form.acType}
            onChange={(e) => setForm({ ...form, acType: e.target.value })}
          >
            <option value="AC">AC</option>
            <option value="NON_AC">Non-AC</option>
          </select>
        </FormRow>
      </div>

      <FormRow label="Variant" hint='Optional — for example "Big Room".'>
        <input
          className="input"
          value={form.variant}
          onChange={(e) => setForm({ ...form, variant: e.target.value })}
        />
      </FormRow>

      <FormRow label="Monthly rent (including food)">
        <input
          className="input tabular"
          inputMode="decimal"
          value={form.amountWithFood}
          onChange={(e) => setForm({ ...form, amountWithFood: e.target.value })}
          placeholder="12000"
        />
      </FormRow>

      <FormRow
        label="Effective from"
        hint="Any existing price for this combination is closed the day before."
      >
        <input
          type="date"
          className="input"
          value={form.effectiveFrom}
          onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
        />
      </FormRow>

      <FormRow label="Reason">
        <input
          className="input"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
          placeholder="Annual revision"
        />
      </FormRow>

      {error && <p className="text-sm text-critical">{error}</p>}
    </Sheet>
  );
}

function ServerTab() {
  const user = useAuthStore((s) => s.user);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const toast = useUiStore((s) => s.toast);
  const [url, setUrl] = useState('');

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ status: string; database: string }>('/health'),
    refetchInterval: 60_000,
  });

  // Reading stored preferences is async, so it belongs in an effect rather
  // than in render.
  useEffect(() => {
    let cancelled = false;
    void getBaseUrl().then((value) => {
      if (!cancelled) setUrl(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Section title="Appearance">
        <Card className="p-4">
          <FormRow label="Theme">
            <select
              className="input"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </FormRow>
        </Card>
      </Section>

      <Section title="Server">
        <Card className="p-4">
          <FormRow
            label="API address"
            hint="Change this if the backend moves — for example to a different machine on your network."
          >
            <input
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoCapitalize="none"
              inputMode="url"
            />
          </FormRow>
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              await setBaseUrl(url);
              toast('Server address saved', 'success');
            }}
          >
            <CheckIcon size={18} />
            Save address
          </button>

          <dl className="mt-4">
            <Field
              label="Connection"
              tone={health?.status === 'ok' ? 'positive' : 'critical'}
              value={health ? `${health.status} · database ${health.database}` : 'Checking…'}
            />
          </dl>
        </Card>
      </Section>

      <Section title="Signed in as">
        <Card className="p-4">
          <dl>
            <Field label="Name" value={user?.fullName} />
            <Field label="Username" value={user?.username} />
            <Field label="Role" value={user?.isOwner ? 'Owner (full access)' : 'Staff'} />
            <Field
              label="Permissions"
              value={user?.isOwner ? 'All' : `${user?.permissions.length ?? 0} granted`}
            />
          </dl>
        </Card>
      </Section>
    </>
  );
}
