import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, BedIcon } from '@/components/Icons';
import {
  Card,
  Chip,
  ErrorState,
  Field,
  LoadingRows,
  Page,
  ResponsiveGrid,
} from '@/components/ui';
import { api } from '@/lib/api';
import { describeSharing, formatDate, formatMoney, initials } from '@/lib/format';

interface RoomDetail {
  id: string;
  name: string;
  capacity: number;
  acType: string;
  variant: string | null;
  notes: string | null;
  occupiedCount: number;
  availableCount: number;
  floor: { name: string; branch: { id: string; name: string } };
  beds: Array<{
    id: string;
    label: string;
    occupied: boolean;
    tenantId?: string;
    tenantName?: string;
    vacatingOn?: string | null;
  }>;
}

export function RoomDetailScreen() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['room', roomId],
    queryFn: () => api.get<RoomDetail>(`/rooms/${roomId}`),
    enabled: Boolean(roomId),
  });

  const { data: price } = useQuery({
    queryKey: ['price', data?.id],
    queryFn: () =>
      api.get<{ baseWithFood: string; monthlyRent: string; source: { scope: string } }>(
        '/pricing/resolve',
        {
          roomId: data!.id,
          branchId: data!.floor.branch.id,
          capacity: data!.capacity,
          acType: data!.acType,
          variant: data!.variant ?? undefined,
          foodIncluded: 'true',
        },
      ),
    enabled: Boolean(data),
    // A room without a configured price is a normal state, not an error to retry.
    retry: false,
  });

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
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight truncate">
            {data?.name ?? 'Room'}
          </h1>
          {data && (
            <p className="text-sm text-ink-muted truncate">
              {data.floor.branch.name} · {data.floor.name} ·{' '}
              {describeSharing(data.capacity, data.acType, data.variant)}
            </p>
          )}
        </div>
      </div>

      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && (
        <>
          <Card className="p-4 mb-5">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="stat-label">Beds</p>
                <p className="stat-value">{data.beds.length}</p>
              </div>
              <div>
                <p className="stat-label">Occupied</p>
                <p className="stat-value">{data.occupiedCount}</p>
              </div>
              <div>
                <p className="stat-label">Available</p>
                <p
                  className={`stat-value ${
                    data.availableCount > 0 ? 'text-positive' : 'text-ink'
                  }`}
                >
                  {data.availableCount}
                </p>
              </div>
              <div>
                <p className="stat-label">Rent (with food)</p>
                <p className="stat-value">
                  {price ? formatMoney(price.baseWithFood) : '—'}
                </p>
              </div>
            </dl>
            {price && (
              <p className="text-xs text-ink-faint mt-3">
                Price resolved from the {price.source.scope.toLowerCase()} rule.
              </p>
            )}
            {!price && (
              <p className="text-xs text-caution mt-3">
                No price configured for this room type yet — add one under Settings → Pricing.
              </p>
            )}
          </Card>

          <h2 className="stat-label mb-2.5">Beds</h2>
          <ResponsiveGrid min={250}>
            {data.beds.map((bed) => (
              <Card
                key={bed.id}
                className="p-3.5"
                onClick={bed.tenantId ? () => navigate(`/tenants/${bed.tenantId}`) : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-10 h-10 rounded-lg border shrink-0 flex items-center justify-center font-semibold ${
                        bed.occupied
                          ? 'bg-surface-raised border-line text-ink-muted'
                          : 'bg-positive/10 border-positive/35 text-positive'
                      }`}
                    >
                      {bed.occupied && bed.tenantName
                        ? initials(bed.tenantName)
                        : bed.label}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {bed.occupied ? bed.tenantName : `Bed ${bed.label}`}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {bed.occupied ? `Bed ${bed.label}` : 'Vacant'}
                      </p>
                    </div>
                  </div>
                  {!bed.occupied && <Chip tone="positive">Free</Chip>}
                </div>

                {bed.occupied && bed.vacatingOn && (
                  <p className="text-xs text-caution mt-2.5">
                    Leaving {formatDate(bed.vacatingOn)}
                  </p>
                )}
              </Card>
            ))}
          </ResponsiveGrid>

          {data.notes && (
            <Card className="p-4 mt-5">
              <dl>
                <Field label="Notes" value={data.notes} />
              </dl>
            </Card>
          )}

          {data.beds.length === 0 && (
            <Card className="p-8 text-center">
              <BedIcon size={28} className="mx-auto text-ink-faint mb-2" />
              <p className="text-ink-muted">This room has no beds configured.</p>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
