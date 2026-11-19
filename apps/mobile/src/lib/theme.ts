import { useColorScheme } from "react-native";
import { paletteFor } from "./palette";
import type { Palette } from "./palette";

export const useTheme = () => paletteFor(useColorScheme() === "dark");

export const screenStyle = (palette: Palette) =>
  ({ backgroundColor: palette.background, flex: 1 }) as const;

export const SPACE = {
  md: 12,
  sm: 8,
} as const;
