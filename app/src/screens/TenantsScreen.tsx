import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlusIcon, SearchIcon, UsersIcon, WarningIcon } from '@/components/Icons';
import {
  TenantContextMenu,
  type TenantMenuTarget,
} from '@/components/TenantContextMenu';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingRows,
  Page,
  PageHeader,
  ResponsiveGrid,
} from '@/components/ui';
import { useLongPress } from '@/hooks/useLongPress';
import { api } from '@/lib/api';
import { formatDate, initials } from '@/lib/format';
import { saveDocument } from '@/lib/download';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { AddTenantSheet } from './tenant/AddTenantSheet';
import { SwitchRoomSheet } from './tenant/SwitchRoomSheet';
import { VacateSheet } from './tenant/VacateSheet';
import type { BranchSummary } from './HomeScreen';

export interface TenantListItem {
  id: string;
  fullName: string;
  mobile: string | null;
  profileComplete: boolean;
  missingCount: number;
  stay: {
    id: string;
    status: string;
    stayType: string;
    checkInDate: string;
    expectedCheckoutDate: string | null;
    foodIncluded: boolean;
  } | null;
  location: {
    branchId: string;
    branchName: string;
    floorName: string;
    roomId: string;
    roomName: string;
    bedId: string;
    bedLabel: string;
  } | null;
}

interface TenantsResponse {
  items: TenantListItem[];
  total: number;
  page: number;
  pageCount: number;
}

export function TenantsScreen() {
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.can);
  const toast = useUiStore((s) => s.toast);
  const branchFilter = useUiStore((s) => s.branchFilter);
  const setBranchFilter = useUiStore((s) => s.setBranchFilter);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [menuTarget, setMenuTarget] = useState<TenantMenuTarget | null>(null);
  const [vacateStayId, setVacateStayId] = useState<string | null>(null);
  const [switchStayId, setSwitchStayId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 280);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: branches } = useQuery({
    queryKey: ['home', 'summary'],
    queryFn: () => api.get<BranchSummary[]>('/home/summary'),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tenants', debounced, status, branchFilter, page],
    queryFn: () =>
      api.get<TenantsResponse>('/tenants', {
        search: debounced || undefined,
        status,
        branchId: branchFilter ?? undefined,
        page,
        pageSize: 30,
      }),
  });

  const openInfoSheet = async (tenantId: string): Promise<void> => {
    setMenuTarget(null);
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

  return (
    <Page>
      <PageHeader
        title="Tenants"
        subtitle={data ? `${data.total} tenant${data.total === 1 ? '' : 's'}` : undefined}
        actions={
          can('tenant.manage') && (
            <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
              <PlusIcon size={18} />
              <span className="hidden sm:inline">Add tenant</span>
            </button>
          )
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative grow">
          <SearchIcon
            size={18}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
          />
          <input
            className="input pl-11"
            placeholder="Search by name or mobile"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoCapitalize="words"
          />
        </div>
        <select
          className="input sm:w-44"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="active">Staying now</option>
          <option value="past">Past tenants</option>
          <option value="">All</option>
        </select>
        <select
          className="input sm:w-48"
          value={branchFilter ?? ''}
          onChange={(e) => {
            setBranchFilter(e.target.value || null);
            setPage(1);
          }}
        >
          <option value="">All branches</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <LoadingRows rows={4} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={<UsersIcon size={30} />}
          title={debounced ? 'No matching tenants' : 'No tenants yet'}
          message={
            debounced
              ? `Nothing matched “${debounced}”.`
              : 'Add a tenant and place them in a bed to start.'
          }
          action={
            can('tenant.manage') &&
            !debounced && (
              <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
                <PlusIcon size={18} />
                Add tenant
              </button>
            )
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <p className="text-xs text-ink-faint mb-2.5 px-1">
            Tip: press and hold a tenant for Vacate, Switch Room and Info.
          </p>
          <ResponsiveGrid min={320}>
            {data.items.map((tenant) => (
              <TenantCard
                key={tenant.id}
                tenant={tenant}
                onOpen={() => navigate(`/tenants/${tenant.id}`)}
                onLongPress={(point) =>
                  setMenuTarget({
                    tenantId: tenant.id,
                    tenantName: tenant.fullName,
                    stayId: tenant.stay?.id ?? null,
                    ...point,
                  })
                }
              />
            ))}
          </ResponsiveGrid>

          {data.pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                type="button"
                className="btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span className="text-sm text-ink-muted tabular">
                {page} of {data.pageCount}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={page >= data.pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      <TenantContextMenu
        target={menuTarget}
        onClose={() => setMenuTarget(null)}
        canVacate={can('tenant.vacate')}
        canAssign={can('tenant.assign')}
        onVacate={() => {
          setVacateStayId(menuTarget?.stayId ?? null);
          setMenuTarget(null);
        }}
        onSwitchRoom={() => {
          setSwitchStayId(menuTarget?.stayId ?? null);
          setMenuTarget(null);
        }}
        onInfo={() => {
          if (menuTarget) void openInfoSheet(menuTarget.tenantId);
        }}
      />

      <AddTenantSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <VacateSheet stayId={vacateStayId} onClose={() => setVacateStayId(null)} />
      <SwitchRoomSheet stayId={switchStayId} onClose={() => setSwitchStayId(null)} />
    </Page>
  );
}

function TenantCard({
  tenant,
  onOpen,
  onLongPress,
}: {
  tenant: TenantListItem;
  onOpen: () => void;
  onLongPress: (point: { x: number; y: number }) => void;
}) {
  const { handlers } = useLongPress(onLongPress);

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        {...handlers}
        className="w-full text-left p-3.5 select-none"
      >
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-full bg-surface-raised border border-line shrink-0 flex items-center justify-center text-sm font-semibold text-ink-muted">
            {initials(tenant.fullName)}
          </span>

          <div className="min-w-0 grow">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold truncate">{tenant.fullName}</h3>
              {!tenant.profileComplete && (
                <span
                  className="text-caution shrink-0"
                  title={`${tenant.missingCount} item(s) missing`}
                >
                  <WarningIcon size={17} />
                </span>
              )}
            </div>

            <p className="text-sm text-ink-muted truncate">
              {tenant.location
                ? `${tenant.location.roomName} · Bed ${tenant.location.bedLabel} · ${tenant.location.branchName}`
                : 'No bed assigned'}
            </p>

            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              {tenant.stay?.status === 'NOTICE_GIVEN' && (
                <Chip tone="caution">Notice given</Chip>
              )}
              {tenant.stay?.stayType === 'DAILY' && <Chip>Daily</Chip>}
              {tenant.stay && (
                <Chip tone={tenant.stay.foodIncluded ? 'positive' : 'neutral'}>
                  {tenant.stay.foodIncluded ? 'With food' : 'No food'}
                </Chip>
              )}
              {!tenant.profileComplete && (
                <Chip tone="caution">{tenant.missingCount} missing</Chip>
              )}
            </div>

            {tenant.stay && (
              <p className="text-xs text-ink-faint mt-2">
                Since {formatDate(tenant.stay.checkInDate)}
                {tenant.stay.expectedCheckoutDate &&
                  ` · leaving ${formatDate(tenant.stay.expectedCheckoutDate)}`}
              </p>
            )}
          </div>
        </div>
      </button>
    </Card>
  );
}
