// no @repo/ui import: it is web-only and the dep-dag guard refuses the edge, so the palette is
// restated here.

import { Platform, useColorScheme } from "react-native";

export interface Theme {
  readonly background: string;
  readonly foreground: string;
  readonly card: string;
  readonly cardForeground: string;
  readonly primary: string;
  readonly primaryForeground: string;
  readonly muted: string;
  readonly mutedForeground: string;
  readonly border: string;
  readonly input: string;
  readonly destructive: string;
}

const light: Theme = {
  background: "#fafafa",
  foreground: "#171717",
  card: "#ffffff",
  cardForeground: "#171717",
  primary: "#171717",
  primaryForeground: "#fafafa",
  muted: "#f4f4f5",
  mutedForeground: "#737373",
  border: "#e5e5e5",
  input: "#e5e5e5",
  destructive: "#ef4444",
};

const dark: Theme = {
  background: "#171717",
  foreground: "#f5f5f5",
  card: "#252525",
  cardForeground: "#f5f5f5",
  primary: "#e5e5e5",
  primaryForeground: "#171717",
  muted: "#1e1e1e",
  mutedForeground: "#a3a3a3",
  border: "#404040",
  input: "#404040",
  destructive: "#f87171",
};

export function themeFor(isDark: boolean): Theme {
  return isDark ? dark : light;
}

export function useTheme(): Theme {
  return themeFor(useColorScheme() === "dark");
}

export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xxl: 24,
} as const;

export const RADIUS = { md: 8 } as const;

// Android ships no Menlo, and an unresolvable family falls back to the proportional sans.
export const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });
