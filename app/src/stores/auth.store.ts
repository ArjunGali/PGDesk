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

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthState {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  error: string | null;
  restore: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Owners bypass every check; this mirrors the server rule exactly. */
  can: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: 'loading',
  error: null,

  async restore() {
    const { access } = await loadTokens();
    if (!access) {
      set({ status: 'unauthenticated', user: null });
      return;
    }
    try {
      const user = await api.get<AuthUser>('/auth/me');
      set({ user, status: 'authenticated', error: null });
    } catch {
      // The interceptor already cleared unusable tokens.
      set({ status: 'unauthenticated', user: null });
    }
  },

  async login(username, password) {
    set({ error: null });
    const result = await api.post<LoginResponse>('/auth/login', {
      username,
      password,
    });
    await saveTokens(result.accessToken, result.refreshToken);
    set({ user: result.user, status: 'authenticated', error: null });
  },

  async logout() {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // Signing out locally matters more than telling the server.
    }
    await saveTokens(null, null);
    set({ user: null, status: 'unauthenticated' });
  },

  can(permission) {
    const user = get().user;
    if (!user) return false;
    return user.isOwner || user.permissions.includes(permission);
  },
}));

// A session that cannot be refreshed drops straight to the sign-in screen.
setUnauthenticatedHandler(() => {
  useAuthStore.setState({ user: null, status: 'unauthenticated' });
});
