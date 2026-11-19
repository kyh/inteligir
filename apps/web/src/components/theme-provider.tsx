import { ThemeProvider as UiThemeProvider } from "@repo/ui/lib/theme";

import { devicePrefs, usePref } from "#library/prefs";

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = usePref(devicePrefs, "theme");

  return (
    <UiThemeProvider theme={theme} setTheme={setTheme}>
      {children}
    </UiThemeProvider>
  );
};
