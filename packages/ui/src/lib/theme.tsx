import { createContext, useContext, useEffect, useMemo, useState } from "react";

// controlled on purpose: each surface owns its own persistence (a localStorage key, an SSR
// no-flash script)

export type Theme = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

export const parseTheme = (value: string | null | undefined): Theme | undefined => {
  if (value === "system" || value === "light" || value === "dark") {
    return value;
  }
  return undefined;
};

const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: ResolvedTheme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider = ({
  theme,
  setTheme,
  children,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  children: React.ReactNode;
}): React.ReactElement => {
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
    };
    mq.addEventListener("change", handler);
    return () => {
      mq.removeEventListener("change", handler);
    };
  }, []);

  const systemTheme: ResolvedTheme = systemDark ? "dark" : "light";
  const resolved: ResolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const value = useMemo(() => ({ resolved, setTheme, theme }), [theme, setTheme, resolved]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return ctx;
};

// runs in <head> before first paint on SSR pages; a client-only shell paints on mount and needs none
export const noFlashThemeScript = (key: string, fallback: Theme = "system"): string =>
  `(function(){try{var t=localStorage.getItem(${JSON.stringify(key)})||${JSON.stringify(fallback)};var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
