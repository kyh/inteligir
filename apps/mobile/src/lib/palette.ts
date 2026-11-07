// The phone's colors as values, for what React Native takes as a value rather than a class: a
// navigator's options, an ActivityIndicator, a safe area's or a WebView's background. They are
// src/styles.css's variables, which the classes read, and src/styles.test.ts compiles that sheet to
// hold the two equal. No react-native import, so a node suite can read it, and no @repo/ui import:
// it is web-only, and the dep-dag guard refuses the edge.

export interface Palette {
  readonly background: string;
  readonly foreground: string;
  readonly primaryForeground: string;
}

const light: Palette = {
  background: "#fafafa",
  foreground: "#171717",
  primaryForeground: "#fafafa",
};

const dark: Palette = {
  background: "#171717",
  foreground: "#f5f5f5",
  primaryForeground: "#171717",
};

export const paletteFor = (isDark: boolean): Palette => (isDark ? dark : light);
