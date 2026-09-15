import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useAuthStore } from './stores/auth.store';
import { useUiStore } from './stores/ui.store';
import { BranchDetailScreen } from './screens/BranchDetailScreen';
import { BranchesScreen } from './screens/BranchesScreen';
import { EbScreen } from './screens/EbScreen';
import { ExpensesScreen } from './screens/ExpensesScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ProfileSelectScreen } from './screens/ProfileSelectScreen';
import { PastTenantsScreen } from './screens/PastTenantsScreen';
import { PaymentsScreen } from './screens/PaymentsScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { RoomDetailScreen } from './screens/RoomDetailScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TenantDetailScreen } from './screens/TenantDetailScreen';
import { TenantsScreen } from './screens/TenantsScreen';
import { VacancyScreen } from './screens/VacancyScreen';

export function App() {
  const status = useAuthStore((s) => s.status);
  const restore = useAuthStore((s) => s.restore);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    void restore();
  }, [restore]);

  // Keep the Android status bar in step with the theme.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
    void StatusBar.setBackgroundColor({
      color: theme === 'dark' ? '#0E0F10' : '#F4F4F2',
    });
  }, [theme]);

  if (status === 'loading') return <SplashScreen />;

  return (
    /* Hash routing: a file:// WebView has no server to resolve deep paths. */
    <HashRouter>
      {/* No login page: the app opens on profile selection, then a PIN. */}
      {status === 'authenticated' ? <AuthenticatedRoutes /> : <ProfileSelectScreen />}
    </HashRouter>
  );
}

function AuthenticatedRoutes() {
  return (
    <>
      <AndroidBackButton />
      <AppShell>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/branches" element={<BranchesScreen />} />
          <Route path="/branches/:branchId" element={<BranchDetailScreen />} />
          <Route path="/rooms/:roomId" element={<RoomDetailScreen />} />
          <Route path="/vacancy" element={<VacancyScreen />} />
          <Route path="/payments" element={<PaymentsScreen />} />
          <Route path="/tenants" element={<TenantsScreen />} />
          <Route path="/tenants/:tenantId" element={<TenantDetailScreen />} />
          <Route path="/past-tenants" element={<PastTenantsScreen />} />
          <Route path="/eb" element={<EbScreen />} />
          <Route path="/expenses" element={<ExpensesScreen />} />
          <Route path="/reports" element={<ReportsScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </>
  );
}

/**
 * The hardware back button should close whatever is open before navigating,
 * and only leave the app from Home. Anything else feels broken on Android.
 */
function AndroidBackButton() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listener = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      const ui = useUiStore.getState();

      if (ui.calculatorOpen) return ui.setCalculatorOpen(false);
      if (ui.searchOpen) return ui.setSearchOpen(false);
      if (ui.notificationsOpen) return ui.setNotificationsOpen(false);
      if (ui.drawerOpen) return ui.setDrawerOpen(false);

      if (canGoBack && window.location.hash !== '#/') {
        navigate(-1);
        return;
      }
      void CapacitorApp.exitApp();
    });

    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [navigate]);

  return null;
}

function SplashScreen() {
  return (
    <div className="min-h-screen bg-base flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 rounded-lg bg-accent/15 border border-accent/30 animate-pulse" />
      <p className="text-ink-muted text-sm">Loading…</p>
    </div>
  );
}
