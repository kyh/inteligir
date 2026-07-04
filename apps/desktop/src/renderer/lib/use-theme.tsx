import { parseTheme, type Theme, ThemeProvider, useTheme } from "@repo/ui/lib/theme";

import { useDiskState } from "@renderer/lib/use-disk-state";

export { useTheme };
export type { Theme };

const THEME_KEY = "theme";

/**
 * Desktop's binding of the shared theme primitive: the theme is persisted to
 * disk (~/.inteligir/ui-state.json) through the Bridge and fed into
 * `@repo/ui`'s controlled `ThemeProvider`. Defaults to light to match the
 * Ophelias-style canvas. Wrap the app once; consumers read `useTheme()`.
 */
export function DesktopThemeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [theme, setTheme] = useDiskState<Theme>(THEME_KEY, "light", parseTheme);
  return (
    <ThemeProvider theme={theme} setTheme={setTheme}>
      {children}
    </ThemeProvider>
  );
}
