import { useLayoutEffect, useMemo, useState, createContext, useContext } from "react";
import { EDITOR_FONTS, EDITOR_LEADINGS, EDITOR_MEASURES, EDITOR_SIZES } from "./appearance-options";
import type { Appearance, Option } from "./appearance-options";
import { readAppearance, writeAppearance } from "./prefs";

const cssOf = <Value extends string>(
  options: readonly Option<Value>[],
  value: Value,
): string | null => options.find((option) => option.value === value)?.css ?? null;

const setToken = (root: HTMLElement, name: string, value: string | null): void => {
  if (value === null) {
    root.style.removeProperty(name);
  } else {
    root.style.setProperty(name, value);
  }
};

const applyAppearance = (appearance: Appearance, root: HTMLElement): void => {
  setToken(root, "--editor-font", cssOf(EDITOR_FONTS, appearance.font));
  setToken(root, "--editor-size", cssOf(EDITOR_SIZES, appearance.size));
  setToken(root, "--editor-line-height", cssOf(EDITOR_LEADINGS, appearance.leading));
  setToken(root, "--editor-width", cssOf(EDITOR_MEASURES, appearance.measure));
};

interface AppearanceContextValue {
  readonly appearance: Appearance;
  readonly setAppearance: (next: Appearance) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

// a layout effect, so the stylesheet default is never painted before the stored value replaces it.
export const AppearanceProvider = ({ children }: { children: React.ReactNode }) => {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);

  useLayoutEffect(() => {
    applyAppearance(appearance, document.documentElement);
  }, [appearance]);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      appearance,
      setAppearance: (next) => {
        writeAppearance(next);
        setAppearance(next);
      },
    }),
    [appearance],
  );

  return <AppearanceContext value={value}>{children}</AppearanceContext>;
};

export const useAppearance = (): AppearanceContextValue => {
  const value = useContext(AppearanceContext);
  if (value === null) {
    throw new Error("useAppearance must be used within an <AppearanceProvider>");
  }
  return value;
};
