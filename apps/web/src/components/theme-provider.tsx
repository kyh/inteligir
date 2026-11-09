import { useSyncExternalStore } from "react";

import { ThemeProvider as UiThemeProvider } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";

import { PREFS, readPref, writePref } from "#library/prefs";

// The document's one theme, the site's and the library's alike: the PREFS row the root's no-flash
// script reads, so Settings › Appearance and the site's toggle are one choice.

const listeners = new Set<() => void>();

// holds the choice when storage is blocked, so the toggle still works for the session
let unpersisted: Theme | null = null;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): Theme => unpersisted ?? readPref(PREFS.theme);

const getServerSnapshot = (): Theme => PREFS.theme.fallback;

const setTheme = (next: Theme): void => {
  writePref(PREFS.theme, next);
  unpersisted = readPref(PREFS.theme) === next ? null : next;
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
