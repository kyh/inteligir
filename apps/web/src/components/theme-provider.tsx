import { useEffect, useState } from "react";

import { parseTheme, type Theme, ThemeProvider as UiThemeProvider } from "@repo/ui/lib/theme";

// Web's binding of the shared theme primitive (`@repo/ui/lib/theme`): persist
// to localStorage, and — because the site is server-rendered — apply the saved
// theme before first paint via the inline script in `__root.tsx`. Defaults to
// dark.
export const THEME_STORAGE_KEY = "theme";
export const THEME_FALLBACK: Theme = "dark";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // SSR-safe: render the fallback on the server, then reconcile from
  // localStorage on the client (the no-flash script already set the class).
  const [theme, setThemeState] = useState<Theme>(THEME_FALLBACK);

  useEffect(() => {
    setThemeState(parseTheme(localStorage.getItem(THEME_STORAGE_KEY)) ?? THEME_FALLBACK);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (private mode) — theme just won't persist.
    }
  };

  return (
    <UiThemeProvider theme={theme} setTheme={setTheme}>
      {children}
    </UiThemeProvider>
  );
}
