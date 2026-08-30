import { useSyncExternalStore } from "react";

import { parseTheme, type Theme, ThemeProvider as UiThemeProvider } from "@repo/ui/lib/theme";

// Web's binding of the shared theme primitive (`@repo/ui/lib/theme`): persist
// to localStorage, and — because the site is server-rendered — apply the saved
// theme before first paint via the inline script in `__root.tsx`. Defaults to
// dark.
export const THEME_STORAGE_KEY = "theme";
export const THEME_FALLBACK: Theme = "dark";

// localStorage *is* the state, so it is read as an external store rather than
// mirrored into React state: the server snapshot renders the fallback on the
// server and through hydration, and the client snapshot reconciles with what
// the no-flash script already painted. The provider is a singleton, so one
// module-level listener set is the whole subscription.
const listeners = new Set<() => void>();

// Holds the choice when a write was refused (storage blocked): the toggle has
// to keep working for the session even when nothing can be persisted.
let unpersisted: Theme | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Theme {
  if (unpersisted !== null) return unpersisted;
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY)) ?? THEME_FALLBACK;
  } catch {
    return THEME_FALLBACK;
  }
}

function getServerSnapshot(): Theme {
  return THEME_FALLBACK;
}

function setTheme(next: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    unpersisted = null;
  } catch {
    // localStorage unavailable (private mode) — theme just won't persist.
    unpersisted = next;
  }
  for (const listener of listeners) listener();
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <UiThemeProvider theme={theme} setTheme={setTheme}>
      {children}
    </UiThemeProvider>
  );
}
