import { useEffect, useRef } from 'react';
import { ExitIcon, InfoIcon, SwapIcon } from './Icons';

export interface TenantMenuTarget {
  tenantId: string;
  tenantName: string;
  stayId: string | null;
  x: number;
  y: number;
}

/**
 * The long-press menu: Vacate, Switch Room, Info.
 *
 * Deliberately only three actions. It appears next to the finger rather than
 * in a corner, and flips when it would run off the screen edge.
 */
export function TenantContextMenu({
  target,
  onClose,
  onVacate,
  onSwitchRoom,
  onInfo,
  canVacate,
  canAssign,
}: {
  target: TenantMenuTarget | null;
  onClose: () => void;
  onVacate: () => void;
  onSwitchRoom: () => void;
  onInfo: () => void;
  canVacate: boolean;
  canAssign: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target) return null;

  const MENU_WIDTH = 210;
  const MENU_HEIGHT = 168;
  const margin = 12;
  const left = Math.min(
    Math.max(margin, target.x - MENU_WIDTH / 2),
    window.innerWidth - MENU_WIDTH - margin,
  );
  // Open upward when there is not enough room below the finger.
  const openUp = target.y + MENU_HEIGHT + margin > window.innerHeight;
  const top = openUp
    ? Math.max(margin, target.y - MENU_HEIGHT - 8)
    : target.y + 8;

  const hasStay = Boolean(target.stayId);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={menuRef}
        className="absolute glass border rounded-card shadow-lift py-1.5 animate-fade-in overflow-hidden"
        style={{ left, top, width: MENU_WIDTH }}
      >
        <p className="px-3.5 py-2 text-xs text-ink-faint truncate border-b border-line mb-1">
          {target.tenantName}
        </p>

        <MenuItem
          icon={<ExitIcon size={18} />}
          label="Vacate"
          onClick={onVacate}
          disabled={!hasStay || !canVacate}
        />
        <MenuItem
          icon={<SwapIcon size={18} />}
          label="Switch Room"
          onClick={onSwitchRoom}
          disabled={!hasStay || !canAssign}
        />
        <MenuItem icon={<InfoIcon size={18} />} label="Info" onClick={onInfo} />
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 px-3.5 min-h-touch text-left
                 hover:bg-surface-raised transition-colors
                 disabled:opacity-40 disabled:pointer-events-none"
    >
      <span className="text-ink-muted">{icon}</span>
      <span className="font-medium">{label}</span>
    </button>
  );
}
