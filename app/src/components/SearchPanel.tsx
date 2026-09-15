import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useUiStore } from '@/stores/ui.store';
import { BuildingIcon, BedIcon, SearchIcon, UsersIcon } from './Icons';
import { Sheet } from './ui';

interface SearchResults {
  tenants: Array<{ id: string; fullName: string; mobile: string | null }>;
  rooms: Array<{
    id: string;
    name: string;
    floorName: string;
    branchName: string;
    branchId: string;
  }>;
  branches: Array<{ id: string; name: string }>;
}

export function SearchPanel() {
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Typing on a phone keyboard is slow; wait for a pause before querying.
    const timer = setTimeout(() => setDebounced(term.trim()), 280);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    if (open) {
      setTerm('');
      setDebounced('');
      // Let the sheet finish animating before stealing focus.
      const timer = setTimeout(() => inputRef.current?.focus(), 220);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResults>('/search', { q: debounced }),
    enabled: debounced.length >= 2,
  });

  const go = (path: string): void => {
    setOpen(false);
    navigate(path);
  };

  const empty =
    debounced.length >= 2 &&
    !isFetching &&
    data &&
    data.tenants.length === 0 &&
    data.rooms.length === 0 &&
    data.branches.length === 0;

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Search">
      <div className="relative mb-4">
        <SearchIcon
          size={19}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
        />
        <input
          ref={inputRef}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Tenant name, mobile, room or branch"
          className="input pl-11"
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>

      {debounced.length < 2 && (
        <p className="text-sm text-ink-muted px-1">
          Type at least two characters to search.
        </p>
      )}

      {empty && (
        <p className="text-sm text-ink-muted px-1">
          Nothing matched “{debounced}”.
        </p>
      )}

      {data && (
        <div className="space-y-5">
          <ResultGroup
            title="Tenants"
            icon={<UsersIcon size={17} />}
            items={data.tenants.map((t) => ({
              key: t.id,
              primary: t.fullName,
              secondary: t.mobile ?? undefined,
              onSelect: () => go(`/tenants/${t.id}`),
            }))}
          />
          <ResultGroup
            title="Rooms"
            icon={<BedIcon size={17} />}
            items={data.rooms.map((r) => ({
              key: r.id,
              primary: r.name,
              secondary: `${r.branchName} · ${r.floorName}`,
              onSelect: () => go(`/rooms/${r.id}`),
            }))}
          />
          <ResultGroup
            title="Branches"
            icon={<BuildingIcon size={17} />}
            items={data.branches.map((b) => ({
              key: b.id,
              primary: b.name,
              onSelect: () => go(`/branches/${b.id}`),
            }))}
          />
        </div>
      )}
    </Sheet>
  );
}

function ResultGroup({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{
    key: string;
    primary: string;
    secondary?: string;
    onSelect: () => void;
  }>;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-ink-muted">
        {icon}
        <span className="stat-label">{title}</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onSelect}
            className="w-full text-left card px-3.5 py-3 hover:border-line-strong transition-colors"
          >
            <p className="font-medium truncate">{item.primary}</p>
            {item.secondary && (
              <p className="text-sm text-ink-muted truncate">{item.secondary}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
