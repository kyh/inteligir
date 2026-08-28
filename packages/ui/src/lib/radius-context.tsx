// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type RadiusVariant = "pill" | "rounded";

interface RadiusClasses {
  item: string;
  bg: string;
  focusRing: string;
  mergedBg: string;
  container: string;
  button: string;
  input: string;
  // Numeric counterparts of `bg` / `mergedBg`, in px. Needed where individual
  // corners are animated (e.g. the selected-background merge/split animation),
  // which requires per-corner numeric border-radii rather than a class.
  bgRadius: number;
  mergedRadius: number;
}

const radiusMap = {
  pill: {
    item: "rounded-[20px]",
    bg: "rounded-[20px]",
    // +2px over `item` because the focus ring sits 2px outside the element
    // (top/left -2, width/height +4); this keeps the corners concentric so a
    // pill element gets a pill ring (matches the rounded-mode 8px→10px bump).
    focusRing: "rounded-[22px]",
    mergedBg: "rounded-2xl",
    container: "rounded-3xl",
    button: "rounded-[20px]",
    input: "rounded-[20px]",
    bgRadius: 20,
    mergedRadius: 16,
  },
  rounded: {
    item: "rounded-lg",
    bg: "rounded-lg",
    focusRing: "rounded-[10px]",
    mergedBg: "rounded-lg",
    container: "rounded-xl",
    button: "rounded-lg",
    input: "rounded-lg",
    bgRadius: 8,
    mergedRadius: 8,
  },
} satisfies Record<RadiusVariant, RadiusClasses>;

interface RadiusContextValue {
  radius: RadiusVariant;
  setRadius: (radius: RadiusVariant) => void;
  classes: RadiusClasses;
}

const RadiusContext = createContext<RadiusContextValue | null>(null);

function useRadius(): RadiusClasses {
  const ctx = useContext(RadiusContext);
  if (!ctx) return radiusMap.pill;
  return ctx.classes;
}

function useRadiusContext() {
  const ctx = useContext(RadiusContext);
  if (!ctx) throw new Error("useRadiusContext must be used within a RadiusProvider");
  return ctx;
}

function RadiusProvider({
  children,
  defaultRadius = "pill",
}: {
  children: ReactNode;
  defaultRadius?: RadiusVariant;
}) {
  const [radius, setRadiusState] = useState<RadiusVariant>(defaultRadius);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Run a state change under the `.transitioning` guard (added + reflow-flushed
  // first so the 180ms border-radius cross-fade applies). Clearing the previous
  // timeout first keeps a double-press from removing the class mid-fade.
  const transitionRadius = useCallback((callback: () => void) => {
    const root = document.documentElement;
    root.classList.add("transitioning");
    void root.offsetHeight;
    callback();
    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    transitionTimeoutRef.current = setTimeout(() => root.classList.remove("transitioning"), 200);
  }, []);

  const setRadius = useCallback(
    (next: RadiusVariant) => {
      transitionRadius(() => setRadiusState(next));
    },
    [transitionRadius],
  );

  // Publish the current element radius as a CSS custom property so plain-CSS
  // consumers that can't read React context stay in sync with the radius
  // system — e.g. the @layer base :focus-visible fallback ring in
  // globals.css. Set on <html> so portalled content sees it too.
  useEffect(() => {
    document.documentElement.style.setProperty("--input-radius", `${radiusMap[radius].bgRadius}px`);
  }, [radius]);

  const value = useMemo(
    () => ({ radius, setRadius, classes: radiusMap[radius] }),
    [radius, setRadius],
  );

  return <RadiusContext.Provider value={value}>{children}</RadiusContext.Provider>;
}

export { RadiusProvider, useRadius, useRadiusContext, radiusMap };
export type { RadiusVariant, RadiusClasses };
