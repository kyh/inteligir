import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

type ResolvedTheme = "light" | "dark";

export const parseTheme = (value: string | null | undefined) => {
  if (value === "system" || value === "light" || value === "dark") {
    return value;
  }

  return null;
};

const systemPrefersDark = () =>
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
}) => {
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

  return <ThemeContext value={{ resolved, setTheme, theme }}>{children}</ThemeContext>;
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);

  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }

  return ctx;
};
