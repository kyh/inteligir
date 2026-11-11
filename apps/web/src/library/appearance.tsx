import { useLayoutEffect, useMemo, createContext, useContext } from "react";
import { appearanceTokens } from "./appearance-options";
import type { Appearance } from "./appearance-options";
import { PREFS, usePref } from "./prefs";

const applyAppearance = (appearance: Appearance, root: HTMLElement): void => {
  for (const { token, css } of appearanceTokens(appearance)) {
    if (css === null) {
      root.style.removeProperty(token);
    } else {
      root.style.setProperty(token, css);
    }
  }
};

interface AppearanceContextValue {
  readonly appearance: Appearance;
  readonly setAppearance: (next: Appearance) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

// a layout effect, so the stylesheet default is never painted before the stored value replaces it.
export const AppearanceProvider = ({ children }: { children: React.ReactNode }) => {
  const [appearance, setAppearance] = usePref(PREFS.appearance);

  useLayoutEffect(() => {
    applyAppearance(appearance, document.documentElement);
  }, [appearance]);

  const value = useMemo<AppearanceContextValue>(
    () => ({ appearance, setAppearance }),
    [appearance, setAppearance],
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
