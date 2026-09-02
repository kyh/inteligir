// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import { createContext, useContext, useEffect, type ReactNode } from "react";

type RadiusVariant = "pill" | "rounded";

interface RadiusClasses {
  item: string;
  bg: string;
  focusRing: string;
  container: string;
  button: string;
  input: string;
  // `bg` in px — for the sidebar's pill-vs-rounded threshold and the
  // `--input-radius` custom property RadiusProvider publishes.
  bgRadius: number;
}

const radiusMap = {
  pill: {
    item: "rounded-[20px]",
    bg: "rounded-[20px]",
    // +2px over `item` because the focus ring sits 2px outside the element
    // (top/left -2, width/height +4); this keeps the corners concentric so a
    // pill element gets a pill ring (matches the rounded-mode 8px→10px bump).
    focusRing: "rounded-[22px]",
    container: "rounded-3xl",
    button: "rounded-[20px]",
    input: "rounded-[20px]",
    bgRadius: 20,
  },
  rounded: {
    item: "rounded-lg",
    bg: "rounded-lg",
    focusRing: "rounded-[10px]",
    container: "rounded-xl",
    button: "rounded-lg",
    input: "rounded-lg",
    bgRadius: 8,
  },
} satisfies Record<RadiusVariant, RadiusClasses>;

const RadiusContext = createContext<RadiusClasses | null>(null);

function useRadius(): RadiusClasses {
  return useContext(RadiusContext) ?? radiusMap.pill;
}

/** Pins the app's radius family once at the root. */
function RadiusProvider({ children, radius }: { children: ReactNode; radius: RadiusVariant }) {
  // Publish the element radius as a CSS custom property so plain-CSS
  // consumers that can't read React context stay in sync with the radius
  // system — e.g. the @layer base :focus-visible fallback ring in
  // globals.css. Set on <html> so portalled content sees it too.
  useEffect(() => {
    document.documentElement.style.setProperty("--input-radius", `${radiusMap[radius].bgRadius}px`);
  }, [radius]);

  return <RadiusContext.Provider value={radiusMap[radius]}>{children}</RadiusContext.Provider>;
}

export { RadiusProvider, useRadius, radiusMap };
export type { RadiusClasses };
