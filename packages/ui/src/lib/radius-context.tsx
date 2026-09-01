// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import { createContext, useContext, useEffect, type ReactNode } from "react";

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
  // corners are animated, which requires per-corner numeric border-radii
  // rather than a class.
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

const RadiusContext = createContext<RadiusClasses | null>(null);

function useRadius(): RadiusClasses {
  return useContext(RadiusContext) ?? radiusMap.pill;
}

/** Pins the app's radius family. Static by design — the runtime dial was a
 *  docs-site affordance; a surface picks its family once at the root. */
function RadiusProvider({
  children,
  defaultRadius = "pill",
}: {
  children: ReactNode;
  defaultRadius?: RadiusVariant;
}) {
  // Publish the element radius as a CSS custom property so plain-CSS
  // consumers that can't read React context stay in sync with the radius
  // system — e.g. the @layer base :focus-visible fallback ring in
  // globals.css. Set on <html> so portalled content sees it too.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--input-radius",
      `${radiusMap[defaultRadius].bgRadius}px`,
    );
  }, [defaultRadius]);

  return (
    <RadiusContext.Provider value={radiusMap[defaultRadius]}>{children}</RadiusContext.Provider>
  );
}

export { RadiusProvider, useRadius, radiusMap };
export type { RadiusClasses };
