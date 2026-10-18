// The phone's colors as values, for what React Native takes as a value rather than a class: a
// navigator's options, an ActivityIndicator, a field's placeholder, a safe area's or a WebView's
// background. They are src/styles.css's variables, which the classes read, and src/styles.test.ts
// compiles that sheet to hold the two equal. No react-native import, so a node suite can read it,
// and no @repo/ui import: it is web-only, and the dep-dag guard refuses the edge.

export interface Palette {
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

const light: Palette = {
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

const dark: Palette = {
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

export const paletteFor = (isDark: boolean): Palette => (isDark ? dark : light);
