import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DocumentIcon, UsersIcon, WarningIcon } from '@/components/Icons';
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
import { saveDocument } from '@/lib/download';
import { formatDate } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

interface VacatedTenant {
  id: string;
  fullName: string;
  mobile: string | null;
  lastCheckout: string | null;
  stayCount: number;
  documentCount: number;
  lastExport: { fileName: string; createdAt: string; format: string } | null;
  erasedAt: string | null;
  settlementStatus: string | null;
}

interface ErasurePreview {
  tenantId: string;
  fullName: string;
  canErase: boolean;
  blockers: string[];
  lastExport: { fileName: string; createdAt: string } | null;
  willRemove: { identityFields: string[]; documents: string[]; customFields: number };
  willKeep: {
    stays: number;
    bills: number;
    payments: number;
    depositEntries: number;
    note: string;
  };
}

/**
 * Past tenants: export their records, then erase their personal data.
 *
 * Kept off the main tenant list on purpose. This is occasional, deliberate
 * housekeeping with an irreversible step in it, not something to stumble into
 * while looking someone up.
 */
export function PastTenantsScreen() {
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.can);
  const toast = useUiStore((s) => s.toast);
  const [erasing, setErasing] = useState<VacatedTenant | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['retention', 'vacated'],
    queryFn: () => api.get<VacatedTenant[]>('/retention/vacated'),
  });

  const exportTenant = async (
    tenant: VacatedTenant,
    format: 'xlsx' | 'pdf',
  ): Promise<void> => {
    try {
      toast('Preparing the export…');
      const { fileName, location } = await saveDocument(
        `/retention/tenants/${tenant.id}/export`,
        { format },
      );
      toast(`Saved ${fileName} to ${location}`, 'success');
      void refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'error');
    }
  };

  return (
    <Page>
      <PageHeader
        title="Past tenants"
        subtitle="Export a former tenant's records, then erase their personal data"
      />

      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && data.length === 0 && (
        <EmptyState
          icon={<UsersIcon size={30} />}
          title="No past tenants yet"
          message="Tenants appear here once every one of their stays has ended."
        />
      )}

      {data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((tenant) => (
            <Card key={tenant.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => navigate(`/tenants/${tenant.id}`)}
                  className="min-w-0 text-left"
                >
                  <h3 className="font-semibold truncate">{tenant.fullName}</h3>
                  <p className="text-xs text-ink-muted">
                    {tenant.stayCount} stay{tenant.stayCount === 1 ? '' : 's'}
                    {tenant.lastCheckout && ` · left ${formatDate(tenant.lastCheckout)}`}
                    {tenant.documentCount > 0 && ` · ${tenant.documentCount} document(s)`}
                  </p>
                </button>
                {tenant.erasedAt ? (
                  <Chip tone="neutral">Erased</Chip>
                ) : tenant.lastExport ? (
                  <Chip tone="positive">Exported</Chip>
                ) : (
                  <Chip tone="caution">Not exported</Chip>
                )}
              </div>

              {tenant.lastExport && !tenant.erasedAt && (
                <p className="text-xs text-ink-faint mt-2">
                  Last export: {tenant.lastExport.fileName} on{' '}
                  {formatDate(tenant.lastExport.createdAt)}
                </p>
              )}
              {tenant.erasedAt && (
                <p className="text-xs text-ink-faint mt-2">
                  Personal data erased {formatDate(tenant.erasedAt)}. Bills, payments
                  and the audit trail were kept.
                </p>
              )}

              {!tenant.erasedAt && (
                <div className="flex flex-wrap gap-2 mt-3.5">
                  {can('export.run') && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary !min-h-0 h-10 text-sm"
                        onClick={() => void exportTenant(tenant, 'xlsx')}
                      >
                        <DocumentIcon size={16} />
                        Export (Excel)
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !min-h-0 h-10 text-sm"
                        onClick={() => void exportTenant(tenant, 'pdf')}
                      >
                        PDF
                      </button>
                    </>
                  )}
                  {can('tenant.erase') && (
                    <button
                      type="button"
                      className="btn-ghost !min-h-0 h-10 text-sm text-critical"
                      onClick={() => setErasing(tenant)}
                    >
                      Erase personal data
                    </button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <EraseSheet tenant={erasing} onClose={() => setErasing(null)} />
    </Page>
  );
}

/**
 * Erasure confirmation.
 *
 * Shows exactly what disappears and exactly what survives, and requires the
 * word ERASE to be typed. This is the one irreversible action in the app.
 */
function EraseSheet({
  tenant,
  onClose,
}: {
  tenant: VacatedTenant | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: preview, isFetching } = useQuery({
    queryKey: ['retention', 'preview', tenant?.id],
    queryFn: () =>
      api.get<ErasurePreview>(`/retention/tenants/${tenant!.id}/erasure-preview`),
    enabled: tenant !== null,
  });

  const erase = useMutation({
    mutationFn: () =>
      api.post(`/retention/tenants/${tenant?.id}/erase`, { reason, confirm }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast('Personal data erased. Financial records were kept.', 'success');
      setReason('');
      setConfirm('');
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not erase the data'),
  });

  const ready =
    preview?.canErase === true && reason.trim().length > 0 && confirm === 'ERASE';

  return (
    <Sheet
      open={tenant !== null}
      onClose={() => {
        setReason('');
        setConfirm('');
        setError(null);
        onClose();
      }}
      title="Erase personal data"
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={!ready || erase.isPending}
            onClick={() => {
              setError(null);
              erase.mutate();
            }}
          >
            {erase.isPending ? 'Erasing…' : 'Erase permanently'}
          </button>
        </>
      }
    >
      {isFetching && !preview && <p className="text-sm text-ink-muted">Checking…</p>}

      {preview && (
        <>
          <div className="flex items-start gap-2.5 p-3 mb-4 rounded-lg bg-critical/10 border border-critical/30">
            <WarningIcon size={18} className="text-critical shrink-0 mt-0.5" />
            <p className="text-sm">
              This cannot be undone. {preview.fullName}&rsquo;s name, contact
              details, address, Aadhaar, notes and uploaded documents will be
              permanently removed from this device and the server.
            </p>
          </div>

          {preview.blockers.length > 0 && (
            <div className="card p-3.5 mb-4 border-caution/40 bg-caution/8">
              <p className="font-medium text-caution mb-1">Not yet possible</p>
              <ul className="text-sm text-ink-muted list-disc pl-5 space-y-1">
                {preview.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <Card className="p-4">
              <p className="stat-label mb-2 text-critical">Removed permanently</p>
              <ul className="text-sm text-ink-muted space-y-1">
                {preview.willRemove.identityFields.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
                {preview.willRemove.documents.map((d) => (
                  <li key={d}>· {d} (document)</li>
                ))}
                {preview.willRemove.customFields > 0 && (
                  <li>· {preview.willRemove.customFields} custom field value(s)</li>
                )}
              </ul>
            </Card>

            <Card className="p-4">
              <p className="stat-label mb-2 text-positive">Kept</p>
              <dl>
                <Field label="Stays" value={preview.willKeep.stays} />
                <Field label="Bills" value={preview.willKeep.bills} />
                <Field label="Payments" value={preview.willKeep.payments} />
                <Field label="Deposit entries" value={preview.willKeep.depositEntries} />
              </dl>
              <p className="text-xs text-ink-faint mt-2">{preview.willKeep.note}</p>
            </Card>
          </div>

          {preview.lastExport && (
            <p className="text-xs text-ink-faint mb-4">
              Last exported as {preview.lastExport.fileName} on{' '}
              {formatDate(preview.lastExport.createdAt)}.
            </p>
          )}

          <FormRow label="Reason" hint="Required. Kept in the audit trail.">
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tenant requested deletion"
            />
          </FormRow>

          <FormRow label="Type ERASE to confirm">
            <input
              className="input tracking-[0.3em] uppercase"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
            />
          </FormRow>

          {error && <p className="text-sm text-critical">{error}</p>}
        </>
      )}
    </Sheet>
  );
}
