import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BedIcon, FilterIcon } from '@/components/Icons';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingRows,
  Page,
  PageHeader,
  ResponsiveGrid,
  Section,
} from '@/components/ui';
import { api } from '@/lib/api';
import { describeSharing, formatDate, relativeDays } from '@/lib/format';
import { useUiStore } from '@/stores/ui.store';
import type { BranchSummary } from './HomeScreen';

interface VacancyBed {
  branchId: string;
  branchName: string;
  floorId: string;
  floorName: string;
  roomId: string;
  roomName: string;
  capacity: number;
  acType: string;
  variant: string | null;
  bedId: string;
  bedLabel: string;
  availableFrom: string;
  occupiedBy?: string;
  tenantId?: string;
}

interface VacancyResponse {
  asOf: string;
  upcomingDays: number;
  totalBeds: number;
  occupiedBeds: number;
  availableCount: number;
  upcomingCount: number;
  available: VacancyBed[];
  upcoming: VacancyBed[];
}

export function VacancyScreen() {
  const navigate = useNavigate();
  const branchFilter = useUiStore((s) => s.branchFilter);
  const setBranchFilter = useUiStore((s) => s.setBranchFilter);
  const [capacity, setCapacity] = useState<string>('');
  const [acType, setAcType] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  const { data: branches } = useQuery({
    queryKey: ['home', 'summary'],
    queryFn: () => api.get<BranchSummary[]>('/home/summary'),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vacancy', branchFilter, capacity, acType],
    queryFn: () =>
      api.get<VacancyResponse>('/vacancy', {
        branchId: branchFilter ?? undefined,
        capacity: capacity || undefined,
        acType: acType || undefined,
      }),
  });

  return (
    <Page>
      <PageHeader
        title="Vacancy"
        subtitle={
          data
            ? `${data.availableCount} bed${data.availableCount === 1 ? '' : 's'} free now · ${
                data.upcomingCount
              } freeing up soon`
            : undefined
        }
        actions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowFilters(!showFilters)}
          >
            <FilterIcon size={18} />
            <span className="hidden sm:inline">Filter</span>
          </button>
        }
      />

      {showFilters && (
        <Card className="p-3.5 mb-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            <div>
              <label className="field-label">Sharing</label>
              <select
                className="input"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              >
                <option value="">Any</option>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} sharing
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Type</label>
              <select className="input" value={acType} onChange={(e) => setAcType(e.target.value)}>
                <option value="">Any</option>
                <option value="AC">AC</option>
                <option value="NON_AC">Non-AC</option>
              </select>
            </div>
          </div>
        </Card>
      )}

      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && data.available.length === 0 && data.upcoming.length === 0 && (
        <EmptyState
          icon={<BedIcon size={30} />}
          title="No vacancy"
          message="Every bed matching these filters is occupied, with none freeing up in the next 30 days."
        />
      )}

      {data && data.available.length > 0 && (
        <Section title={`Available now · ${data.available.length}`}>
          <ResponsiveGrid min={260}>
            {data.available.map((bed) => (
              <Card
                key={bed.bedId}
                onClick={() => navigate(`/rooms/${bed.roomId}`)}
                className="p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold">
                      {bed.roomName} · Bed {bed.bedLabel}
                    </h3>
                    <p className="text-xs text-ink-muted mt-0.5 truncate">
                      {bed.branchName} · {bed.floorName}
                    </p>
                  </div>
                  <Chip tone="positive">Free</Chip>
                </div>
                <p className="text-xs text-ink-faint mt-2.5">
                  {describeSharing(bed.capacity, bed.acType, bed.variant)}
                </p>
              </Card>
            ))}
          </ResponsiveGrid>
        </Section>
      )}

      {data && data.upcoming.length > 0 && (
        <Section title={`Freeing up within ${data.upcomingDays} days · ${data.upcoming.length}`}>
          <ResponsiveGrid min={260}>
            {data.upcoming.map((bed) => (
              <Card
                key={bed.bedId}
                onClick={() =>
                  bed.tenantId ? navigate(`/tenants/${bed.tenantId}`) : navigate(`/rooms/${bed.roomId}`)
                }
                className="p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold">
                      {bed.roomName} · Bed {bed.bedLabel}
                    </h3>
                    <p className="text-xs text-ink-muted mt-0.5 truncate">
                      {bed.branchName} · {bed.floorName}
                    </p>
                  </div>
                  <Chip tone="caution">{relativeDays(bed.availableFrom)}</Chip>
                </div>
                <p className="text-sm text-ink-muted mt-2.5 truncate">{bed.occupiedBy}</p>
                <p className="text-xs text-ink-faint mt-0.5">
                  Free from {formatDate(bed.availableFrom)}
                </p>
              </Card>
            ))}
          </ResponsiveGrid>
        </Section>
      )}
    </Page>
  );
}
