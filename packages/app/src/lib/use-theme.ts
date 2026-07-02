import { useEffect, useState } from "react";

import { useDiskState } from "./use-disk-state";

export type Theme = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_KEY = "theme";

function parseTheme(value: unknown): Theme | undefined {
  if (value === "system" || value === "light" || value === "dark") return value;
  return undefined;
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Theme state persisted to disk (~/.inteligir/ui-state.json), resolved against
 * the OS preference for "system". Applying the `.dark` class to the document
 * root is a side-effect of reading the resolved theme, so any caller keeps the
 * document in sync. Defaults to light to match the Ophelias-style canvas.
 */
export function useTheme(): {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: ResolvedTheme;
} {
  const [theme, setTheme] = useDiskState(THEME_KEY, "light", parseTheme);
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

  return { theme, setTheme, resolved };
}
