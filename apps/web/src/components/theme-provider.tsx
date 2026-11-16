import { ThemeProvider as UiThemeProvider } from "@repo/ui/lib/theme";

import { devicePrefs, usePref } from "#library/prefs";

// The document's one theme, the site's and the library's alike: the device's pref the root's
// no-flash script reads, so Settings › Appearance and the site's toggle are one choice.
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = usePref(devicePrefs, "theme");

  return (
    <UiThemeProvider theme={theme} setTheme={setTheme}>
      {children}
    </UiThemeProvider>
  );
};
