import { useSyncExternalStore } from "react";

import { parseTheme, ThemeProvider as UiThemeProvider } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";

// the no-flash inline script in __root.tsx reads the same key and fallback; keep them in sync
export const THEME_STORAGE_KEY = "theme";
export const THEME_FALLBACK: Theme = "dark";

const listeners = new Set<() => void>();

// holds the choice when storage is blocked, so the toggle still works for the session
let unpersisted: Theme | null = null;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): Theme => {
  if (unpersisted !== null) {
    return unpersisted;
  }
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY)) ?? THEME_FALLBACK;
  } catch {
    return THEME_FALLBACK;
  }
};

const getServerSnapshot = (): Theme => THEME_FALLBACK;

const setTheme = (next: Theme): void => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    unpersisted = null;
  } catch {
    unpersisted = next;
  }
  for (const listener of listeners) {
    listener();
  }
};

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <UiThemeProvider theme={theme} setTheme={setTheme}>
      {children}
    </UiThemeProvider>
  );
};
