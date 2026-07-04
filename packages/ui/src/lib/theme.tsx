import { createContext, useContext, useEffect, useMemo, useState } from "react";

// Shared theme primitive for every frontend (the desktop renderer + the web
// marketing site). The *state source* differs per app — desktop persists to
// disk through the Bridge, web to localStorage with an SSR no-flash script —
// so the provider is **controlled**: each app owns persistence and passes the
// current `theme` + `setTheme`, and this owns the OS-preference resolution, the
// `.dark` class on <html>, and the shared context/API.

export type Theme = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export function parseTheme(value: unknown): Theme | undefined {
  if (value === "system" || value === "light" || value === "dark") return value;
  return undefined;
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: ResolvedTheme;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  theme,
  setTheme,
  children,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const resolved: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const value = useMemo(() => ({ theme, setTheme, resolved }), [theme, setTheme, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a <ThemeProvider>");
  return ctx;
}

/**
 * The inline script the server-rendered web app runs in `<head>` before first
 * paint, so a saved/system dark theme is applied without a flash of the wrong
 * mode. (The Electron renderer is a local SPA with no hydration, so it doesn't
 * need this.) `key` is the localStorage key the web ThemeProvider writes to.
 */
export function noFlashThemeScript(key: string, fallback: Theme = "system"): string {
  return `(function(){try{var t=localStorage.getItem(${JSON.stringify(key)})||${JSON.stringify(fallback)};var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
}
