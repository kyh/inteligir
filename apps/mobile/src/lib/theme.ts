import { useColorScheme } from "react-native";
import { paletteFor } from "./palette";
import type { Palette } from "./palette";

// the palette of the scheme the system is in, the one src/styles.css's dark variables follow
export const useTheme = (): Palette => paletteFor(useColorScheme() === "dark");

// a Pressable's `hitSlop`, which takes a value and no class
export const SPACE = {
  md: 12,
  sm: 8,
} as const;
