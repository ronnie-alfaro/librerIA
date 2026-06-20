import { create } from 'zustand';
import type { ThemeMode, WorkspaceTab } from './domain';

type WorkspaceState = {
  activeBookId: string;
  activeView: 'library' | 'workspace' | 'search' | 'settings';
  activeTab: WorkspaceTab;
  setBook: (bookId: string) => void;
  setView: (view: WorkspaceState['activeView']) => void;
  setTab: (tab: WorkspaceTab) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeBookId: '',
  activeView: 'library',
  activeTab: 'overview',
  setBook: (bookId) => set({ activeBookId: bookId, activeView: 'workspace' }),
  setView: (activeView) => set({ activeView }),
  setTab: (activeTab) => set({ activeTab }),
}));

type ThemeState = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolvedMode: () => 'light' | 'dark';
};

function initialTheme(): ThemeMode {
  const stored = window.localStorage.getItem('libreria_theme');
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'light';
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialTheme(),
  setMode: (mode) => {
    window.localStorage.setItem('libreria_theme', mode);
    set({ mode });
  },
  resolvedMode: () => {
    const mode = get().mode;
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode;
  },
}));
