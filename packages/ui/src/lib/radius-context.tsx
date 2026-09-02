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
  bgRadius: number;
}

const radiusMap = {
  pill: {
    item: "rounded-[20px]",
    bg: "rounded-[20px]",
    // +2px over `item`: the focus ring sits 2px outside the element, and this keeps the corners concentric
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

function RadiusProvider({ children, radius }: { children: ReactNode; radius: RadiusVariant }) {
  // published as a custom property for plain-CSS consumers (globals.css's :focus-visible fallback);
  // on <html> so portalled content sees it
  useEffect(() => {
    document.documentElement.style.setProperty("--input-radius", `${radiusMap[radius].bgRadius}px`);
  }, [radius]);

  return <RadiusContext.Provider value={radiusMap[radius]}>{children}</RadiusContext.Provider>;
}

export { RadiusProvider, useRadius, radiusMap };
export type { RadiusClasses };
