// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import { createContext, useContext, useEffect } from "react";
import type { ReactNode } from "react";

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
    bg: "rounded-[20px]",
    bgRadius: 20,
    button: "rounded-[20px]",
    container: "rounded-3xl",
    // +2px over `item`: the focus ring sits 2px outside the element, and this keeps the corners concentric
    focusRing: "rounded-[22px]",
    input: "rounded-[20px]",
    item: "rounded-[20px]",
  },
  rounded: {
    bg: "rounded-lg",
    bgRadius: 8,
    button: "rounded-lg",
    container: "rounded-xl",
    focusRing: "rounded-[10px]",
    input: "rounded-lg",
    item: "rounded-lg",
  },
} satisfies Record<RadiusVariant, RadiusClasses>;

const RadiusContext = createContext<RadiusClasses | null>(null);

const useRadius = (): RadiusClasses => useContext(RadiusContext) ?? radiusMap.pill;

const RadiusProvider = ({ children, radius }: { children: ReactNode; radius: RadiusVariant }) => {
  // published as a custom property for plain-CSS consumers (globals.css's :focus-visible fallback);
  // on <html> so portalled content sees it
  useEffect(() => {
    document.documentElement.style.setProperty("--input-radius", `${radiusMap[radius].bgRadius}px`);
  }, [radius]);

  return <RadiusContext.Provider value={radiusMap[radius]}>{children}</RadiusContext.Provider>;
};

export { RadiusProvider, useRadius, radiusMap };
export type { RadiusClasses };
