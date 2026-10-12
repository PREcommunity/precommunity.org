'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

export type { ResolvedTheme, ThemePreference } from '@/lib/theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const storageKey = 'precommunity-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let initial: ThemePreference = 'system';
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (isThemePreference(saved)) initial = saved;
    } catch {
      // Use the system theme when browser storage is unavailable.
    }
    setPreference(initial);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (value: ThemePreference) => {
      const resolved = resolveTheme(value, media.matches);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', resolved === 'dark' ? '#07172a' : '#2d8eff');
      setResolvedTheme(resolved);
    };

    apply(preference);
    const onChange = () => {
      if (preference === 'system') apply('system');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference, ready]);

  const updatePreference = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // The choice still applies when browser storage is unavailable.
    }
    setPreference(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      setPreference: updatePreference,
    }),
    [preference, resolvedTheme, updatePreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
