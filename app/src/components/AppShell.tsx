import { useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { Calculator } from './Calculator';
import {
  BellIcon,
  BoltIcon,
  BuildingIcon,
  CalculatorIcon,
  ChartIcon,
  CloseIcon,
  HomeIcon,
  MenuIcon,
  MoonIcon,
  RupeeIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  UsersIcon,
  WalletIcon,
  BedIcon,
} from './Icons';
import { NotificationPanel, useUnreadCount } from './NotificationPanel';
import { SearchPanel } from './SearchPanel';
import { Toaster } from './Toaster';

/**
 * Primary navigation stays at four items — Home, Branches, Vacancy, Payments.
 * Everything else lives behind the hamburger, so the daily screens stay simple.
 */
const PRIMARY_NAV = [
  { to: '/', label: 'Home', Icon: HomeIcon, end: true },
  { to: '/branches', label: 'Branches', Icon: BuildingIcon },
  { to: '/vacancy', label: 'Vacancy', Icon: BedIcon },
  { to: '/payments', label: 'Payments', Icon: WalletIcon },
];

const DRAWER_NAV = [
  { to: '/', label: 'Home', Icon: HomeIcon, end: true },
  { to: '/tenants', label: 'Tenants', Icon: UsersIcon },
  { to: '/eb', label: 'E.B. Calculations', Icon: BoltIcon },
  { to: '/expenses', label: 'Expenses', Icon: RupeeIcon },
  { to: '/reports', label: 'Reports', Icon: ChartIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isTabletUp } = useBreakpoint();
  const location = useLocation();
  const drawerOpen = useUiStore((s) => s.drawerOpen);
  const setDrawerOpen = useUiStore((s) => s.setDrawerOpen);
  const calculatorOpen = useUiStore((s) => s.calculatorOpen);
  const setCalculatorOpen = useUiStore((s) => s.setCalculatorOpen);

  // Navigating away should always close the drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, setDrawerOpen]);

  return (
    <div className="min-h-screen bg-base">
      <TopBar />

      <div className="flex">
        {/* A tablet has room for a permanent rail; a phone does not. */}
        {isTabletUp && <SideRail />}
        <main className="grow min-w-0">{children}</main>
      </div>

      {!isTabletUp && <BottomNav />}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <SearchPanel />
      <NotificationPanel />
      <Calculator open={calculatorOpen} onClose={() => setCalculatorOpen(false)} />
      <Toaster />

      {/* Floating calculator — always within thumb reach, never in the way. */}
      <button
        type="button"
        onClick={() => setCalculatorOpen(true)}
        aria-label="Open calculator"
        className="fixed right-4 z-30 w-14 h-14 rounded-full glass border shadow-lift
                   flex items-center justify-center text-ink hover:text-accent
                   transition-colors"
        style={{
          bottom: `calc(${isTabletUp ? '1.5rem' : '5.5rem'} + env(safe-area-inset-bottom, 0px))`,
        }}
      >
        <CalculatorIcon size={24} />
      </button>
    </div>
  );
}

function TopBar() {
  const navigate = useNavigate();
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setDrawerOpen = useUiStore((s) => s.setDrawerOpen);
  const unread = useUnreadCount();

  return (
    <header
      className="sticky top-0 z-40 glass border-b"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="mx-auto max-w-[1400px] px-3 sm:px-5 h-16 flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-2.5 px-2 h-touch rounded-lg hover:bg-surface-raised transition-colors mr-auto min-w-0"
        >
          <span className="w-8 h-8 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
            <BuildingIcon size={17} className="text-accent" />
          </span>
          {/* On a narrow phone the mark alone is clearer than a clipped word. */}
          <span className="font-semibold tracking-tight truncate hidden xs:inline">
            PG Management
          </span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="btn-ghost w-touch h-touch !min-h-0 !px-0"
        >
          {theme === 'dark' ? <SunIcon size={21} /> : <MoonIcon size={21} />}
        </button>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          className="btn-ghost w-touch h-touch !min-h-0 !px-0"
        >
          <SearchIcon size={21} />
        </button>

        <NotificationButton unread={unread} />

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Menu"
          className="btn-ghost w-touch h-touch !min-h-0 !px-0"
        >
          <MenuIcon size={21} />
        </button>
      </div>
    </header>
  );
}

function NotificationButton({ unread }: { unread: number }) {
  const setNotificationsOpen = useUiStore((s) => s.setNotificationsOpen);
  return (
    <button
      type="button"
      onClick={() => setNotificationsOpen(true)}
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      className="btn-ghost w-touch h-touch !min-h-0 !px-0 relative"
    >
      <BellIcon size={21} />
      {unread > 0 && (
        <span
          className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full
                     bg-critical text-white text-[10px] font-semibold
                     flex items-center justify-center tabular"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}

function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 glass border-t"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="grid grid-cols-4">
        {PRIMARY_NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 h-[4.25rem] transition-colors ${
                isActive ? 'text-accent' : 'text-ink-muted'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={22} strokeWidth={isActive ? 2 : 1.6} />
                <span className="text-[11px] font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** Tablet/landscape rail: the same four destinations, always visible. */
function SideRail() {
  return (
    <nav className="sticky top-16 h-[calc(100vh-4rem)] w-[13.5rem] shrink-0 border-r border-line px-3 py-5 hidden sm:block">
      <div className="space-y-1">
        {PRIMARY_NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 min-h-touch rounded-lg font-medium transition-colors ${
                isActive
                  ? 'bg-accent/12 text-accent border border-accent/25'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-raised border border-transparent'
              }`
            }
          >
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>

      <div className="mt-6 pt-5 border-t border-line space-y-1">
        {DRAWER_NAV.filter((item) => item.to !== '/').map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 min-h-touch rounded-lg text-sm transition-colors ${
                isActive ? 'text-accent' : 'text-ink-muted hover:text-ink hover:bg-surface-raised'
              }`
            }
          >
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const lock = useAuthStore((s) => s.lock);
  const navigate = useNavigate();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0 bg-black/55 animate-fade-in" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 w-[19rem] max-w-[86vw] glass border-r shadow-lift animate-slide-in-left flex flex-col">
        <div
          className="flex items-center justify-between px-5 h-16 border-b border-line shrink-0"
          style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <span className="font-semibold">Menu</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="btn-ghost w-touch h-touch !min-h-0 !px-0"
          >
            <CloseIcon />
          </button>
        </div>

        <nav className="grow overflow-y-auto py-3">
          {DRAWER_NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3.5 px-5 min-h-[3.25rem] transition-colors ${
                  isActive
                    ? 'text-accent bg-accent/8 border-r-2 border-accent'
                    : 'text-ink hover:bg-surface-raised'
                }`
              }
            >
              <Icon size={21} />
              <span className="font-medium">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div
          className="border-t border-line p-4 shrink-0"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="px-1 mb-3">
            <p className="font-medium truncate">{user?.fullName}</p>
            <p className="text-xs text-ink-muted truncate">
              {user?.isOwner ? 'Owner' : user?.username}
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={async () => {
              await lock();
              navigate('/');
            }}
          >
            Switch profile
          </button>
        </div>
      </div>
    </div>
  );
}
