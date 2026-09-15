import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BuildingIcon, ChevronRightIcon } from '@/components/Icons';
import {
  Card,
  ErrorState,
  LoadingRows,
  Page,
  PageHeader,
  ResponsiveGrid,
  EmptyState,
} from '@/components/ui';
import { api } from '@/lib/api';

export interface BranchSummary {
  id: string;
  name: string;
  code: string | null;
  status: string;
  totalBeds: number;
  occupiedBeds: number;
  currentVacancy: number;
  upcomingVacancy: number;
  paymentPending: number;
  floorCount: number;
  roomCount: number;
}

/**
 * The property overview, and nothing else.
 *
 * There is deliberately no "needs attention" panel here: pending payments,
 * incomplete profiles and upcoming checkouts belong under the bell, and
 * duplicating them would make the screen the owner opens most the busiest one.
 */
export function HomeScreen() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['home', 'summary'],
    queryFn: () => api.get<BranchSummary[]>('/home/summary'),
  });

  const totals = (data ?? []).reduce(
    (acc, b) => ({
      beds: acc.beds + b.totalBeds,
      occupied: acc.occupied + b.occupiedBeds,
      vacancy: acc.vacancy + b.currentVacancy,
    }),
    { beds: 0, occupied: 0, vacancy: 0 },
  );

  return (
    <Page>
      <PageHeader
        title="Home"
        subtitle={
          data && data.length > 0
            ? `${totals.occupied} of ${totals.beds} beds occupied across ${data.length} branch${
                data.length === 1 ? '' : 'es'
              }`
            : undefined
        }
      />

      {isLoading && <LoadingRows rows={2} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && data.length === 0 && (
        <EmptyState
          icon={<BuildingIcon size={30} />}
          title="No branches yet"
          message="Add your first branch to start managing rooms and tenants."
          action={
            <button
              type="button"
              className="btn-primary"
              onClick={() => navigate('/branches')}
            >
              Go to Branches
            </button>
          }
        />
      )}

      {data && data.length > 0 && (
        <ResponsiveGrid min={340}>
          {data.map((branch) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              onOpen={() => navigate(`/branches/${branch.id}`)}
            />
          ))}
        </ResponsiveGrid>
      )}
    </Page>
  );
}

/**
 * Compact by design: a name, three numbers, and a quiet line of context.
 * No oversized coloured statistic tiles.
 */
function BranchCard({
  branch,
  onOpen,
}: {
  branch: BranchSummary;
  onOpen: () => void;
}) {
  return (
    <Card onClick={onOpen} className="p-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold tracking-tight uppercase truncate">
            {branch.name}
          </h3>
          <p className="text-xs text-ink-muted mt-0.5">
            {branch.floorCount} floor{branch.floorCount === 1 ? '' : 's'} ·{' '}
            {branch.roomCount} room{branch.roomCount === 1 ? '' : 's'} ·{' '}
            {branch.totalBeds} bed{branch.totalBeds === 1 ? '' : 's'}
          </p>
        </div>
        <ChevronRightIcon size={19} className="text-ink-faint shrink-0 mt-1" />
      </div>

      <dl className="space-y-2">
        <StatRow label="Current Vacancy" value={branch.currentVacancy} />
        <StatRow label="Upcoming Vacancy" value={branch.upcomingVacancy} />
        <StatRow
          label="Payment Pending"
          value={branch.paymentPending}
          tone={branch.paymentPending > 0 ? 'caution' : 'default'}
        />
      </dl>
    </Card>
  );
}

function StatRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'caution';
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd
        className={`text-lg font-semibold tabular ${
          tone === 'caution' && value > 0 ? 'text-caution' : 'text-ink'
        }`}
      >
        {String(value).padStart(2, '0')}
      </dd>
    </div>
  );
}
