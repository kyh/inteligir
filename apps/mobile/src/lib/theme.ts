// ---------------------------------------------------------------------------
// The zinc design tokens for the mobile companion, resolved to concrete hex for
// light and dark. Mirrors packages/ui/src/styles/globals.css by convention —
// mobile does NOT import @repo/ui, which is web-only — so keep these in sync
// when the palette changes. Same shape as markdown-styles.ts: a light map, a
// dark map, and one selector taking the resolved scheme.
// ---------------------------------------------------------------------------

import { useColorScheme } from "react-native";

export interface Theme {
  readonly background: string;
  readonly foreground: string;
  readonly card: string;
  readonly cardForeground: string;
  readonly popover: string;
  readonly popoverForeground: string;
  readonly primary: string;
  readonly primaryForeground: string;
  readonly secondary: string;
  readonly secondaryForeground: string;
  readonly muted: string;
  readonly mutedForeground: string;
  readonly accent: string;
  readonly accentForeground: string;
  readonly destructive: string;
  readonly destructiveForeground: string;
  readonly border: string;
  readonly input: string;
  readonly ring: string;
}

const light: Theme = {
  background: "#fafafa",
  foreground: "#171717",
  card: "#ffffff",
  cardForeground: "#171717",
  popover: "#ffffff",
  popoverForeground: "#171717",
  primary: "#171717",
  primaryForeground: "#fafafa",
  secondary: "#f4f4f5",
  secondaryForeground: "#171717",
  muted: "#f4f4f5",
  mutedForeground: "#737373",
  accent: "#e5e5e5",
  accentForeground: "#171717",
  destructive: "#ef4444",
  destructiveForeground: "#ffffff",
  border: "#e5e5e5",
  input: "#e5e5e5",
  ring: "#d4d4d4",
};

const dark: Theme = {
  background: "#171717",
  foreground: "#f5f5f5",
  card: "#252525",
  cardForeground: "#f5f5f5",
  popover: "#252525",
  popoverForeground: "#f5f5f5",
  primary: "#e5e5e5",
  primaryForeground: "#171717",
  secondary: "#1e1e1e",
  secondaryForeground: "#f5f5f5",
  muted: "#1e1e1e",
  mutedForeground: "#a3a3a3",
  accent: "#525252",
  accentForeground: "#f5f5f5",
  destructive: "#f87171",
  destructiveForeground: "#f5f5f5",
  border: "#404040",
  input: "#404040",
  ring: "#404040",
};

/** The token set for the given color scheme. */
export function themeFor(isDark: boolean): Theme {
  return isDark ? dark : light;
}

/** The token set for the device's current color scheme. */
export function useTheme(): Theme {
  return themeFor(useColorScheme() === "dark");
}

/** The 4pt spacing rhythm the screens lay out on. */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const RADIUS = { sm: 4, md: 8, full: 9999 } as const;
