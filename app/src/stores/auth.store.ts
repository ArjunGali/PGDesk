import { create } from 'zustand';
import {
  api,
  loadTokens,
  saveTokens,
  setUnauthenticatedHandler,
} from '@/lib/api';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  isOwner: boolean;
  permissions: string[];
  branchIds: string[];
}

/** A card on the "Who's using the app?" screen. */
export interface Profile {
  id: string;
  fullName: string;
  roleNames: string[];
  isOwner: boolean;
  avatarPath: string | null;
  avatarColor: string | null;
  hasPin: boolean;
  lockedUntil: string | null;
}

interface UnlockResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthState {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  /** Which profile card is selected; drives the PIN screen. */
  selectedProfile: Profile | null;

  restore: () => Promise<void>;
  selectProfile: (profile: Profile | null) => void;
  unlock: (profileId: string, pin: string) => Promise<void>;
  setInitialPin: (profileId: string, pin: string) => Promise<void>;
  lock: () => Promise<void>;
  /** Owners bypass every check; this mirrors the server rule exactly. */
  can: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: 'loading',
  selectedProfile: null,

  async restore() {
    const { access } = await loadTokens();
    if (!access) {
      set({ status: 'unauthenticated', user: null });
      return;
    }
    try {
      const user = await api.get<AuthUser>('/auth/me');
      set({ user, status: 'authenticated' });
    } catch {
      // The interceptor already cleared unusable tokens.
      set({ status: 'unauthenticated', user: null });
    }
  },

  selectProfile(selectedProfile) {
    set({ selectedProfile });
  },

  async unlock(profileId, pin) {
    const result = await api.post<UnlockResponse>('/auth/unlock', { profileId, pin });
    await saveTokens(result.accessToken, result.refreshToken);
    set({ user: result.user, status: 'authenticated', selectedProfile: null });
  },

  async setInitialPin(profileId, pin) {
    const result = await api.post<UnlockResponse>('/auth/set-pin', { profileId, pin });
    await saveTokens(result.accessToken, result.refreshToken);
    set({ user: result.user, status: 'authenticated', selectedProfile: null });
  },

  /** Returns to the profile screen — the app's equivalent of signing out. */
  async lock() {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // Locking locally matters more than telling the server.
    }
    await saveTokens(null, null);
    set({ user: null, status: 'unauthenticated', selectedProfile: null });
  },

  can(permission) {
    const user = get().user;
    if (!user) return false;
    return user.isOwner || user.permissions.includes(permission);
  },
}));

// A session that cannot be refreshed drops back to the profile screen.
setUnauthenticatedHandler(() => {
  useAuthStore.setState({
    user: null,
    status: 'unauthenticated',
    selectedProfile: null,
  });
});
