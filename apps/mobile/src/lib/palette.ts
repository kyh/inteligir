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

export const paletteFor = (isDark: boolean) => (isDark ? dark : light);
