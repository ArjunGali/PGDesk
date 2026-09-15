import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  BedIcon,
  ChevronDownIcon,
  PlusIcon,
} from '@/components/Icons';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FormRow,
  LoadingRows,
  Page,
  ResponsiveGrid,
  Sheet,
} from '@/components/ui';
import { api } from '@/lib/api';
import { describeSharing } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

interface BedNode {
  id: string;
  label: string;
  occupied: boolean;
  tenantId?: string;
  tenantName?: string;
  stayId?: string;
  vacatingOn?: string | null;
}

interface RoomNode {
  id: string;
  name: string;
  capacity: number;
  acType: string;
  variant: string | null;
  occupiedCount: number;
  availableCount: number;
  beds: BedNode[];
}

interface FloorNode {
  id: string;
  name: string;
  floorType: string | null;
  rooms: RoomNode[];
  totalBeds: number;
  occupiedBeds: number;
}

interface BranchTree {
  id: string;
  name: string;
  address: string | null;
  contact: string | null;
  status: string;
  floors: FloorNode[];
}

/** Branch → Floors → Rooms → Beds, the hierarchy the Home card drills into. */
export function BranchDetailScreen() {
  const { branchId = '' } = useParams();
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.can);
  const [addFloorOpen, setAddFloorOpen] = useState(false);
  const [addRoomFloorId, setAddRoomFloorId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['branch', branchId, 'tree'],
    queryFn: () => api.get<BranchTree>(`/branches/${branchId}/tree`),
    enabled: Boolean(branchId),
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
        <div className="min-w-0 grow">
          <h1 className="text-2xl font-semibold tracking-tight truncate">
            {data?.name ?? 'Branch'}
          </h1>
          {data?.address && (
            <p className="text-sm text-ink-muted mt-0.5 truncate">{data.address}</p>
          )}
        </div>
        {can('branch.manage') && (
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={() => setAddFloorOpen(true)}
          >
            <PlusIcon size={18} />
            <span className="hidden sm:inline">Floor</span>
          </button>
        )}
      </div>

      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && data.floors.length === 0 && (
        <EmptyState
          title="No floors yet"
          message="Add a floor, then add the rooms on it."
          action={
            can('branch.manage') && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => setAddFloorOpen(true)}
              >
                <PlusIcon size={18} />
                Add floor
              </button>
            )
          }
        />
      )}

      <div className="space-y-5">
        {data?.floors.map((floor) => (
          <FloorSection
            key={floor.id}
            floor={floor}
            canManage={can('room.manage')}
            onAddRoom={() => setAddRoomFloorId(floor.id)}
          />
        ))}
      </div>

      <AddFloorSheet
        open={addFloorOpen}
        onClose={() => setAddFloorOpen(false)}
        branchId={branchId}
      />
      <AddRoomSheet
        floorId={addRoomFloorId}
        onClose={() => setAddRoomFloorId(null)}
        branchId={branchId}
      />
    </Page>
  );
}

function FloorSection({
  floor,
  canManage,
  onAddRoom,
}: {
  floor: FloorNode;
  canManage: boolean;
  onAddRoom: () => void;
}) {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();

  return (
    <section>
      <div className="flex items-center gap-2 mb-2.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 grow min-h-touch text-left"
        >
          <ChevronDownIcon
            size={18}
            className={`text-ink-faint transition-transform ${open ? '' : '-rotate-90'}`}
          />
          <span className="font-semibold">{floor.name}</span>
          <span className="text-sm text-ink-muted">
            {floor.occupiedBeds}/{floor.totalBeds} beds
          </span>
        </button>
        {canManage && (
          <button type="button" className="btn-ghost !min-h-0 h-touch px-3" onClick={onAddRoom}>
            <PlusIcon size={17} />
            <span className="text-sm">Room</span>
          </button>
        )}
      </div>

      {open && (
        <>
          {floor.rooms.length === 0 ? (
            <p className="text-sm text-ink-muted px-1 py-3">No rooms on this floor yet.</p>
          ) : (
            <ResponsiveGrid min={270}>
              {floor.rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  onOpen={() => navigate(`/rooms/${room.id}`)}
                />
              ))}
            </ResponsiveGrid>
          )}
        </>
      )}
    </section>
  );
}

function RoomCard({ room, onOpen }: { room: RoomNode; onOpen: () => void }) {
  return (
    <Card onClick={onOpen} className="p-3.5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h4 className="font-semibold">{room.name}</h4>
          <p className="text-xs text-ink-muted mt-0.5">
            {describeSharing(room.capacity, room.acType, room.variant)}
          </p>
        </div>
        <Chip tone={room.availableCount > 0 ? 'positive' : 'neutral'}>
          {room.availableCount > 0 ? `${room.availableCount} free` : 'Full'}
        </Chip>
      </div>

      {/* Beds as small blocks: occupancy is legible at a glance. */}
      <div className="flex flex-wrap gap-1.5">
        {room.beds.map((bed) => (
          <span
            key={bed.id}
            title={bed.occupied ? `${bed.label}: ${bed.tenantName}` : `${bed.label}: vacant`}
            className={`inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-md
                        text-xs font-medium border ${
                          bed.occupied
                            ? 'bg-surface-raised border-line text-ink-muted'
                            : 'bg-positive/10 border-positive/35 text-positive'
                        }`}
          >
            {bed.label}
          </span>
        ))}
      </div>

      {room.beds.some((b) => b.occupied) && (
        <p className="text-xs text-ink-faint mt-2.5 truncate">
          {room.beds
            .filter((b) => b.occupied)
            .map((b) => b.tenantName)
            .join(', ')}
        </p>
      )}
    </Card>
  );
}

function AddFloorSheet({
  open,
  onClose,
  branchId,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
}) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [name, setName] = useState('');
  const [floorTypeId, setFloorTypeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: floorTypes } = useQuery({
    queryKey: ['floor-types'],
    queryFn: () =>
      api.get<Array<{ id: string; name: string }>>('/floor-types'),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post(`/branches/${branchId}/floors`, {
        name: name.trim(),
        floorTypeId: floorTypeId || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['branch', branchId] });
      void queryClient.invalidateQueries({ queryKey: ['home', 'summary'] });
      toast('Floor added', 'success');
      setName('');
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not add the floor'),
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add floor"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!name.trim() || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            {create.isPending ? 'Adding…' : 'Add floor'}
          </button>
        </>
      }
    >
      <FormRow label="Floor name">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ground Floor"
        />
      </FormRow>
      <FormRow label="Floor type" hint="Used for ordering. Add more types in Settings.">
        <select
          className="input"
          value={floorTypeId}
          onChange={(e) => setFloorTypeId(e.target.value)}
        >
          <option value="">Not specified</option>
          {floorTypes?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormRow>
      {error && <p className="text-sm text-critical">{error}</p>}
    </Sheet>
  );
}

function AddRoomSheet({
  floorId,
  onClose,
  branchId,
}: {
  floorId: string | null;
  onClose: () => void;
  branchId: string;
}) {
  const queryClient = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [form, setForm] = useState({ name: '', capacity: '3', acType: 'AC', variant: '' });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post(`/floors/${floorId}/rooms`, {
        name: form.name.trim(),
        capacity: Number(form.capacity),
        acType: form.acType,
        variant: form.variant.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['branch', branchId] });
      void queryClient.invalidateQueries({ queryKey: ['home', 'summary'] });
      toast(`Room added with ${form.capacity} bed(s)`, 'success');
      setForm({ name: '', capacity: '3', acType: 'AC', variant: '' });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not add the room'),
  });

  return (
    <Sheet
      open={floorId !== null}
      onClose={onClose}
      title="Add room"
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
            {create.isPending ? 'Adding…' : 'Add room'}
          </button>
        </>
      }
    >
      <FormRow label="Room name or number">
        <input
          className="input"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="101"
        />
      </FormRow>
      <FormRow
        label="Sharing"
        hint="Beds are created automatically to match, labelled A, B, C…"
      >
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
      <FormRow label="Air conditioning">
        <select
          className="input"
          value={form.acType}
          onChange={(e) => setForm({ ...form, acType: e.target.value })}
        >
          <option value="AC">AC</option>
          <option value="NON_AC">Non-AC</option>
        </select>
      </FormRow>
      <FormRow
        label="Variant"
        hint='Optional, for rooms priced differently — for example "Big Room".'
      >
        <input
          className="input"
          value={form.variant}
          onChange={(e) => setForm({ ...form, variant: e.target.value })}
        />
      </FormRow>
      {error && <p className="text-sm text-critical">{error}</p>}
      <p className="text-xs text-ink-faint flex items-start gap-2 mt-2">
        <BedIcon size={15} className="shrink-0 mt-0.5" />
        Availability is always worked out from beds and assignments, never stored
        as a flag on the room.
      </p>
    </Sheet>
  );
}
