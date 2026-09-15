import { create } from 'zustand';

export type Theme = 'dark' | 'light';

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

interface UiState {
  theme: Theme;
  drawerOpen: boolean;
  searchOpen: boolean;
  notificationsOpen: boolean;
  calculatorOpen: boolean;
  /** Branch filter shared by Vacancy, Payments and Reports. */
  branchFilter: string | null;
  toasts: Toast[];

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setDrawerOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setNotificationsOpen: (open: boolean) => void;
  setCalculatorOpen: (open: boolean) => void;
  setBranchFilter: (branchId: string | null) => void;
  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
}

const THEME_KEY = 'pgm.theme';

function readStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* private mode */
  }
  return 'dark';
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? '#0E0F10' : '#F4F4F2');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode */
  }
}

let toastId = 0;

export const useUiStore = create<UiState>((set, get) => ({
  theme: readStoredTheme(),
  drawerOpen: false,
  searchOpen: false,
  notificationsOpen: false,
  calculatorOpen: false,
  branchFilter: null,
  toasts: [],

  setTheme(theme) {
    applyTheme(theme);
    set({ theme });
  },

  toggleTheme() {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },

  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),
  setCalculatorOpen: (calculatorOpen) => set({ calculatorOpen }),
  setBranchFilter: (branchFilter) => set({ branchFilter }),

  toast(message, tone = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 6000 : 3500);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
