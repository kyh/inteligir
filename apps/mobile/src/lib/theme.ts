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
  border: "#e5e5e5",
  card: "#ffffff",
  cardForeground: "#171717",
  destructive: "#ef4444",
  foreground: "#171717",
  input: "#e5e5e5",
  muted: "#f4f4f5",
  mutedForeground: "#737373",
  primary: "#171717",
  primaryForeground: "#fafafa",
};

const dark: Theme = {
  background: "#171717",
  border: "#404040",
  card: "#252525",
  cardForeground: "#f5f5f5",
  destructive: "#f87171",
  foreground: "#f5f5f5",
  input: "#404040",
  muted: "#1e1e1e",
  mutedForeground: "#a3a3a3",
  primary: "#e5e5e5",
  primaryForeground: "#171717",
};

export const themeFor = (isDark: boolean): Theme => (isDark ? dark : light);

export const useTheme = (): Theme => themeFor(useColorScheme() === "dark");

export const SPACE = {
  lg: 16,
  md: 12,
  sm: 8,
  xs: 4,
  xxl: 24,
} as const;

export const RADIUS = { md: 8 } as const;

// Android ships no Menlo, and an unresolvable family falls back to the proportional sans.
export const MONO_FONT = Platform.select({ default: "monospace", ios: "Menlo" });
