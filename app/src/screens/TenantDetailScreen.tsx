import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ExitIcon,
  InfoIcon,
  SwapIcon,
  WarningIcon,
} from '@/components/Icons';
import {
  Card,
  Chip,
  ErrorState,
  Field,
  FormRow,
  LoadingRows,
  Page,
  Sheet,
} from '@/components/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { api } from '@/lib/api';
import { saveDocument } from '@/lib/download';
import {
  describeSharing,
  formatDate,
  formatMoney,
  initials,
  toInputDate,
} from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { DocumentsPanel } from './tenant/DocumentsPanel';
import { SwitchRoomSheet } from './tenant/SwitchRoomSheet';
import { VacateSheet } from './tenant/VacateSheet';

interface TenantDetail {
  id: string;
  fullName: string;
  mobile: string | null;
  emergencyContact: string | null;
  emergencyName: string | null;
  permanentAddress: string | null;
  officeAddress: string | null;
  officeName: string | null;
  notes: string | null;
  completeness: {
    complete: boolean;
    missingFields: Array<{ key: string; label: string }>;
    missingDocuments: Array<{ key: string; name: string }>;
  };
  currentStayId: string | null;
  currentLocation: {
    branchName: string;
    floorName: string;
    roomId: string;
    roomName: string;
    capacity: number;
    acType: string;
    bedLabel: string;
  } | null;
  customFieldValues: Array<{
    id: string;
    value: string;
    definition: { key: string; label: string };
  }>;
  documents: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    uploadedAt: string;
    verification: string;
    documentType: { id: string; name: string };
  }>;
  stays: Array<{
    id: string;
    stayType: string;
    status: string;
    checkInDate: string;
    expectedCheckoutDate: string | null;
    actualCheckoutDate: string | null;
    depositAmount: string;
    notes: string | null;
    assignments: Array<{
      id: string;
      startDate: string;
      endDate: string | null;
      reason: string | null;
      bed: {
        label: string;
        room: {
          name: string;
          capacity: number;
          acType: string;
          floor: { name: string; branch: { name: string } };
        };
      };
    }>;
    foodPeriods: Array<{
      id: string;
      foodIncluded: boolean;
      effectiveFrom: string;
      effectiveTo: string | null;
      reason: string | null;
    }>;
    pricingRules: Array<{
      id: string;
      amountWithFood: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      reason: string | null;
    }>;
    invoices: Array<{
      id: string;
      number: string;
      periodStart: string;
      periodEnd: string;
      dueDate: string;
      status: string;
      totalAmount: string;
      paidAmount: string;
      lines: Array<{ id: string; kind: string; description: string; amount: string }>;
    }>;
    payments: Array<{
      id: string;
      receiptNo: string;
      amount: string;
      method: string;
      paidAt: string;
      reversedAt: string | null;
    }>;
    depositLedger: Array<{
      id: string;
      type: string;
      amount: string;
      occurredAt: string;
      reason: string | null;
    }>;
    ebCharges: Array<{
      id: string;
      units: string;
      amount: string;
      occupiedDays: number;
      cycle: { periodStart: string; periodEnd: string; ratePerUnit: string };
    }>;
    notice: {
      noticeDate: string;
      requiredUntilDate: string;
      noticeDaysRequired: number;
      shortfallDays: number;
    } | null;
    settlement: {
      id: string;
      status: string;
      netAmount: string;
      depositStatus: string;
      checkoutDate: string;
    } | null;
  }>;
}

type Tab = 'overview' | 'money' | 'history' | 'documents';

export function TenantDetailScreen() {
  const { tenantId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.can);
  const toast = useUiStore((s) => s.toast);
  const { isTabletUp } = useBreakpoint();

  const [tab, setTab] = useState<Tab>(
    searchParams.get('complete') ? 'overview' : 'overview',
  );
  const [vacateOpen, setVacateOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [foodOpen, setFoodOpen] = useState(false);
  const [rentOpen, setRentOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => api.get<TenantDetail>(`/tenants/${tenantId}`),
    enabled: Boolean(tenantId),
  });

  const currentStay =
    data?.stays.find((s) => s.id === data.currentStayId) ?? data?.stays[0] ?? null;

  const downloadInfoSheet = async (): Promise<void> => {
    try {
      toast('Preparing information sheet…');
      const { fileName, location } = await saveDocument(
        `/exports/tenants/${tenantId}/info-sheet.pdf`,
      );
      toast(`Saved ${fileName} to ${location}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not produce the sheet', 'error');
    }
  };

  if (isLoading) {
    return (
      <Page>
        <LoadingRows rows={4} />
      </Page>
    );
  }
  if (error || !data) {
    return (
      <Page>
        <ErrorState error={error} onRetry={() => refetch()} />
      </Page>
    );
  }

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'money', label: 'Money' },
    { key: 'history', label: 'History' },
    { key: 'documents', label: 'Documents' },
  ];

  return (
    <Page>
      <div className="flex items-start gap-2 mb-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="btn-ghost w-touch h-touch !min-h-0 !px-0 shrink-0 -ml-2"
        >
          <ArrowLeftIcon />
        </button>

        <span className="w-12 h-12 rounded-full bg-surface-raised border border-line shrink-0 flex items-center justify-center font-semibold text-ink-muted">
          {initials(data.fullName)}
        </span>

        <div className="min-w-0 grow">
          <h1 className="text-2xl font-semibold tracking-tight truncate">
            {data.fullName}
          </h1>
          <p className="text-sm text-ink-muted truncate">
            {data.currentLocation
              ? `${data.currentLocation.roomName} · Bed ${data.currentLocation.bedLabel} · ${data.currentLocation.branchName}`
              : 'Not currently assigned to a bed'}
          </p>
        </div>
      </div>

      {!data.completeness.complete && (
        <IncompleteBanner
          completeness={data.completeness}
          onComplete={() => setEditOpen(true)}
        />
      )}

      {/* Primary actions, mirroring the long-press menu. */}
      <div className="flex flex-wrap gap-2 mb-5">
        {currentStay && currentStay.status !== 'VACATED' && can('tenant.assign') && (
          <button type="button" className="btn-secondary" onClick={() => setSwitchOpen(true)}>
            <SwapIcon size={18} />
            Switch room
          </button>
        )}
        {currentStay && currentStay.status !== 'VACATED' && can('tenant.vacate') && (
          <button type="button" className="btn-secondary" onClick={() => setVacateOpen(true)}>
            <ExitIcon size={18} />
            Vacate
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={downloadInfoSheet}>
          <InfoIcon size={18} />
          Info sheet
        </button>
        {can('tenant.manage') && (
          <button type="button" className="btn-ghost" onClick={() => setEditOpen(true)}>
            Edit details
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-line mb-5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 min-h-touch font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className={isTabletUp ? 'grid grid-cols-2 gap-5 items-start' : 'space-y-5'}>
          <Card className="p-4">
            <p className="stat-label mb-2">Personal</p>
            <dl>
              <Field label="Full name" value={data.fullName} />
              <Field label="Mobile" value={data.mobile} />
              <Field label="Emergency contact name" value={data.emergencyName} />
              <Field label="Emergency contact" value={data.emergencyContact} />
              <Field label="Office / college" value={data.officeName} />
              <Field label="Permanent address" value={data.permanentAddress} />
              <Field label="Office address" value={data.officeAddress} />
              {data.customFieldValues.map((v) => (
                <Field key={v.id} label={v.definition.label} value={v.value} />
              ))}
              <Field label="Notes" value={data.notes} />
            </dl>
          </Card>

          {currentStay && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="stat-label">Current stay</p>
                <Chip
                  tone={
                    currentStay.status === 'VACATED'
                      ? 'neutral'
                      : currentStay.status === 'NOTICE_GIVEN'
                        ? 'caution'
                        : 'positive'
                  }
                >
                  {currentStay.status.replace('_', ' ').toLowerCase()}
                </Chip>
              </div>
              <dl>
                <Field label="Branch" value={data.currentLocation?.branchName} />
                <Field label="Floor" value={data.currentLocation?.floorName} />
                <Field label="Room" value={data.currentLocation?.roomName} />
                <Field label="Bed" value={data.currentLocation?.bedLabel} />
                <Field
                  label="Sharing"
                  value={describeSharing(
                    data.currentLocation?.capacity,
                    data.currentLocation?.acType,
                  )}
                />
                <Field label="Stay type" value={currentStay.stayType} />
                <Field label="Check-in" value={formatDate(currentStay.checkInDate)} />
                <Field
                  label="Expected checkout"
                  value={formatDate(currentStay.expectedCheckoutDate)}
                />
                <Field
                  label="Actual checkout"
                  value={formatDate(currentStay.actualCheckoutDate)}
                />
                <Field
                  label="Food"
                  value={
                    currentStay.foodPeriods.find((f) => !f.effectiveTo)?.foodIncluded
                      ? 'Included'
                      : 'Not included'
                  }
                />
                <Field label="Deposit agreed" mono value={formatMoney(currentStay.depositAmount)} />
              </dl>

              {can('tenant.manage') && currentStay.status !== 'VACATED' && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {currentStay.stayType !== 'DAILY' && (
                    <button
                      type="button"
                      className="btn-ghost !min-h-0 h-10 text-sm"
                      onClick={() => setFoodOpen(true)}
                    >
                      Change food status
                    </button>
                  )}
                  {can('pricing.manage') && (
                    <button
                      type="button"
                      className="btn-ghost !min-h-0 h-10 text-sm"
                      onClick={() => setRentOpen(true)}
                    >
                      Set custom rent
                    </button>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === 'money' && currentStay && <MoneyTab stay={currentStay} />}
      {tab === 'history' && <HistoryTab stays={data.stays} />}
      {tab === 'documents' && (
        <DocumentsPanel tenantId={tenantId} documents={data.documents} />
      )}

      <VacateSheet
        stayId={vacateOpen ? currentStay?.id ?? null : null}
        onClose={() => setVacateOpen(false)}
      />
      <SwitchRoomSheet
        stayId={switchOpen ? currentStay?.id ?? null : null}
        onClose={() => setSwitchOpen(false)}
      />
      <FoodSheet
        stayId={foodOpen ? currentStay?.id ?? null : null}
        onClose={() => setFoodOpen(false)}
      />
      <CustomRentSheet
        stayId={rentOpen ? currentStay?.id ?? null : null}
        onClose={() => setRentOpen(false)}
      />
      <EditTenantSheet
        tenant={editOpen ? data : null}
        onClose={() => setEditOpen(false)}
      />
    </Page>
  );
}

function IncompleteBanner({
  completeness,
  onComplete,
}: {
  completeness: TenantDetail['completeness'];
  onComplete: () => void;
}) {
  const missing = [
    ...completeness.missingFields.map((f) => f.label),
    ...completeness.missingDocuments.map((d) => d.name),
  ];
  return (
    <div className="card border-caution/40 bg-caution/8 p-4 mb-5">
      <div className="flex items-start gap-3">
        <WarningIcon size={20} className="text-caution shrink-0 mt-0.5" />
        <div className="grow min-w-0">
          <p className="font-medium text-caution">Incomplete profile</p>
          <p className="text-sm text-ink-muted mt-1">Missing: {missing.join(', ')}</p>
          <button type="button" className="btn-secondary mt-3" onClick={onComplete}>
            Complete profile
          </button>
        </div>
      </div>
    </div>
  );
}

function MoneyTab({ stay }: { stay: TenantDetail['stays'][number] }) {
  const billed = stay.invoices.reduce((sum, i) => sum + Number(i.totalAmount), 0);
  const paid = stay.invoices.reduce((sum, i) => sum + Number(i.paidAmount), 0);
  const deposit = stay.depositLedger.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <p className="stat-label mb-3">Position</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="stat-label">Billed</p>
            <p className="stat-value">{formatMoney(billed)}</p>
          </div>
          <div>
            <p className="stat-label">Paid</p>
            <p className="stat-value text-positive">{formatMoney(paid)}</p>
          </div>
          <div>
            <p className="stat-label">Balance</p>
            <p
              className={`stat-value ${billed - paid > 0 ? 'text-caution' : 'text-ink'}`}
            >
              {formatMoney(billed - paid)}
            </p>
          </div>
          <div>
            <p className="stat-label">Deposit held</p>
            <p className="stat-value">{formatMoney(deposit)}</p>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <p className="stat-label mb-3">Bills</p>
        {stay.invoices.length === 0 ? (
          <p className="text-sm text-ink-muted">No bills yet.</p>
        ) : (
          <div className="space-y-2">
            {stay.invoices.map((invoice) => (
              <div key={invoice.id} className="border border-line rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{invoice.number}</p>
                    <p className="text-xs text-ink-muted">
                      {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="tabular font-semibold">
                      {formatMoney(invoice.totalAmount)}
                    </p>
                    <Chip
                      tone={
                        invoice.status === 'PAID'
                          ? 'positive'
                          : invoice.status === 'CANCELLED'
                            ? 'neutral'
                            : 'caution'
                      }
                    >
                      {invoice.status.replace('_', ' ').toLowerCase()}
                    </Chip>
                  </div>
                </div>
                <ul className="mt-2.5 pt-2.5 border-t border-line space-y-1">
                  {invoice.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex justify-between gap-3 text-sm text-ink-muted"
                    >
                      <span className="truncate">{line.description}</span>
                      <span className="tabular shrink-0">{formatMoney(line.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <p className="stat-label mb-3">Payments</p>
        {stay.payments.length === 0 ? (
          <p className="text-sm text-ink-muted">No payments recorded.</p>
        ) : (
          <ul className="divide-y divide-line">
            {stay.payments.map((payment) => (
              <li key={payment.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{payment.receiptNo}</p>
                  <p className="text-xs text-ink-muted">
                    {formatDate(payment.paidAt)} · {payment.method.replace('_', ' ')}
                  </p>
                </div>
                <span
                  className={`tabular font-medium shrink-0 ${
                    payment.reversedAt ? 'line-through text-ink-faint' : ''
                  }`}
                >
                  {formatMoney(payment.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <p className="stat-label mb-3">Deposit ledger</p>
        {stay.depositLedger.length === 0 ? (
          <p className="text-sm text-ink-muted">No deposit movements.</p>
        ) : (
          <ul className="divide-y divide-line">
            {stay.depositLedger.map((entry) => (
              <li key={entry.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">
                    {entry.type.replace(/_/g, ' ').toLowerCase()}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {formatDate(entry.occurredAt)}
                    {entry.reason && ` · ${entry.reason}`}
                  </p>
                </div>
                <span
                  className={`tabular font-medium shrink-0 ${
                    Number(entry.amount) < 0 ? 'text-critical' : 'text-positive'
                  }`}
                >
                  {formatMoney(entry.amount, { sign: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {stay.ebCharges.length > 0 && (
        <Card className="p-4">
          <p className="stat-label mb-3">E.B. history</p>
          <ul className="divide-y divide-line">
            {stay.ebCharges.map((charge) => (
              <li key={charge.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">
                    {formatDate(charge.cycle.periodStart)} –{' '}
                    {formatDate(charge.cycle.periodEnd)}
                  </p>
                  <p className="text-xs text-ink-muted tabular">
                    {charge.units} units · {charge.occupiedDays} days ·{' '}
                    {formatMoney(charge.cycle.ratePerUnit)}/unit
                  </p>
                </div>
                <span className="tabular font-medium shrink-0">
                  {formatMoney(charge.amount)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {stay.settlement && (
        <Card className="p-4">
          <p className="stat-label mb-3">Final settlement</p>
          <dl>
            <Field label="Status" value={stay.settlement.status} />
            <Field label="Checkout" value={formatDate(stay.settlement.checkoutDate)} />
            <Field label="Deposit status" value={stay.settlement.depositStatus.replace(/_/g, ' ')} />
            <Field
              label={Number(stay.settlement.netAmount) < 0 ? 'Amount payable' : 'Refund due'}
              mono
              tone={Number(stay.settlement.netAmount) < 0 ? 'critical' : 'positive'}
              value={formatMoney(Math.abs(Number(stay.settlement.netAmount)))}
            />
          </dl>
        </Card>
      )}
    </div>
  );
}

/** Room history, food history and rent history — never overwritten, always shown. */
function HistoryTab({ stays }: { stays: TenantDetail['stays'] }) {
  return (
    <div className="space-y-5">
      {stays.map((stay, index) => (
        <Card key={stay.id} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="stat-label">
              Stay {stays.length - index} · {formatDate(stay.checkInDate)} –{' '}
              {stay.actualCheckoutDate ? formatDate(stay.actualCheckoutDate) : 'current'}
            </p>
            <Chip tone={stay.status === 'VACATED' ? 'neutral' : 'positive'}>
              {stay.status.replace('_', ' ').toLowerCase()}
            </Chip>
          </div>

          <p className="text-xs uppercase tracking-wider text-ink-faint mt-4 mb-1.5">
            Room history
          </p>
          <ul className="divide-y divide-line">
            {stay.assignments.map((a) => (
              <li key={a.id} className="py-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="truncate">
                    {a.bed.room.floor.branch.name} · {a.bed.room.name} · Bed {a.bed.label}
                  </span>
                  <span className="text-ink-muted shrink-0 tabular text-xs">
                    {formatDate(a.startDate, 'day')} –{' '}
                    {a.endDate ? formatDate(a.endDate, 'day') : 'now'}
                  </span>
                </div>
                {a.reason && <p className="text-xs text-ink-faint mt-0.5">{a.reason}</p>}
              </li>
            ))}
          </ul>

          <p className="text-xs uppercase tracking-wider text-ink-faint mt-4 mb-1.5">
            Food history
          </p>
          <ul className="divide-y divide-line">
            {stay.foodPeriods.map((f) => (
              <li key={f.id} className="py-2 text-sm flex justify-between gap-3">
                <span>{f.foodIncluded ? 'With food' : 'Without food'}</span>
                <span className="text-ink-muted shrink-0 tabular text-xs">
                  {formatDate(f.effectiveFrom, 'day')} –{' '}
                  {f.effectiveTo ? formatDate(f.effectiveTo, 'day') : 'onward'}
                </span>
              </li>
            ))}
          </ul>

          {stay.pricingRules.length > 0 && (
            <>
              <p className="text-xs uppercase tracking-wider text-ink-faint mt-4 mb-1.5">
                Tenant-specific rent
              </p>
              <ul className="divide-y divide-line">
                {stay.pricingRules.map((rule) => (
                  <li key={rule.id} className="py-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="tabular">{formatMoney(rule.amountWithFood)}</span>
                      <span className="text-ink-muted shrink-0 tabular text-xs">
                        {formatDate(rule.effectiveFrom, 'day')} –{' '}
                        {rule.effectiveTo ? formatDate(rule.effectiveTo, 'day') : 'onward'}
                      </span>
                    </div>
                    {rule.reason && (
                      <p className="text-xs text-ink-faint mt-0.5">{rule.reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {stay.notice && (
            <>
              <p className="text-xs uppercase tracking-wider text-ink-faint mt-4 mb-1.5">
                Notice
              </p>
              <p className="text-sm text-ink-muted">
                Given {formatDate(stay.notice.noticeDate)} ·{' '}
                {stay.notice.noticeDaysRequired} days required · until{' '}
                {formatDate(stay.notice.requiredUntilDate)}
                {stay.notice.shortfallDays > 0 &&
                  ` · ${stay.notice.shortfallDays} day(s) short`}
              </p>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}

function FoodSheet({ stayId, onClose }: { stayId: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [foodIncluded, setFoodIncluded] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(toInputDate());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () =>
      api.post(`/stays/${stayId}/food`, {
        foodIncluded,
        effectiveFrom,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast('Food status updated from that date', 'success');
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not change food status'),
  });

  return (
    <Sheet
      open={stayId !== null}
      onClose={onClose}
      title="Change food status"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={change.isPending}
            onClick={() => {
              setError(null);
              change.mutate();
            }}
          >
            {change.isPending ? 'Saving…' : 'Apply from this date'}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-muted mb-4">
        The change applies from the date you choose onward. Bills already issued
        keep the status they were billed on.
      </p>

      <FormRow label="New status">
        <select
          className="input"
          value={foodIncluded ? 'yes' : 'no'}
          onChange={(e) => setFoodIncluded(e.target.value === 'yes')}
        >
          <option value="yes">With food</option>
          <option value="no">Without food</option>
        </select>
      </FormRow>
      <FormRow label="Effective from">
        <input
          type="date"
          className="input"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </FormRow>
      <FormRow label="Reason">
        <input
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Tenant opted out"
        />
      </FormRow>
      {error && <p className="text-sm text-critical">{error}</p>}
    </Sheet>
  );
}

function CustomRentSheet({
  stayId,
  onClose,
}: {
  stayId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [amount, setAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(toInputDate());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/stays/${stayId}/custom-rent`, { amount, effectiveFrom, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast('Custom rent applied', 'success');
      setAmount('');
      setReason('');
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not set the rent'),
  });

  return (
    <Sheet
      open={stayId !== null}
      onClose={onClose}
      title="Tenant-specific rent"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!amount || !reason.trim() || save.isPending}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending ? 'Saving…' : 'Apply'}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-muted mb-4">
        This overrides the room price for this tenant only. Enter the amount
        inclusive of food; if they do not take food, the configured food
        difference is deducted automatically.
      </p>
      <FormRow label="Monthly rent (with food)">
        <input
          className="input tabular"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="11000"
        />
      </FormRow>
      <FormRow label="Effective from">
        <input
          type="date"
          className="input"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </FormRow>
      <FormRow label="Reason" hint="Required — this is a financial change and is audited.">
        <input
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Long-stay discount agreed"
        />
      </FormRow>
      {error && <p className="text-sm text-critical">{error}</p>}
    </Sheet>
  );
}

function EditTenantSheet({
  tenant,
  onClose,
}: {
  tenant: TenantDetail | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const value = (key: keyof TenantDetail): string =>
    form[key] ?? (tenant?.[key] as string | null) ?? '';

  const save = useMutation({
    mutationFn: () => api.patch(`/tenants/${tenant?.id}`, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenant', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast('Details saved', 'success');
      setForm({});
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save'),
  });

  const fields: Array<[keyof TenantDetail, string]> = [
    ['fullName', 'Full name'],
    ['mobile', 'Mobile'],
    ['emergencyName', 'Emergency contact name'],
    ['emergencyContact', 'Emergency contact number'],
    ['officeName', 'Office / college'],
    ['permanentAddress', 'Permanent address'],
    ['officeAddress', 'Office address'],
    ['notes', 'Notes'],
  ];

  return (
    <Sheet
      open={tenant !== null}
      onClose={onClose}
      title="Edit tenant details"
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={Object.keys(form).length === 0 || save.isPending}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        {fields.map(([key, label]) => (
          <FormRow key={key} label={label}>
            {key === 'permanentAddress' || key === 'officeAddress' || key === 'notes' ? (
              <textarea
                className="input min-h-[4.5rem]"
                value={value(key)}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            ) : (
              <input
                className="input"
                value={value(key)}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            )}
          </FormRow>
        ))}
      </div>
      {error && <p className="text-sm text-critical">{error}</p>}
    </Sheet>
  );
}
