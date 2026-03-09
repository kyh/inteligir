"use client";

import React from "react";

import { useMediaQuery } from "@/registry/hooks/use-media-query";
import { useMounted } from "@/registry/hooks/use-mounted";

export const breakpointSizes = {
  "2xl": 1400,
  lg: 1024,
  md: 768,
  sm: 640,
  xl: 1280,
};

export type Breakpoint = keyof typeof breakpointSizes;

const TailwindContext = React.createContext<{
  isDesktop: boolean;
}>({
  isDesktop: false,
});

const useTailwindContext = () => {
  const context = React.useContext(TailwindContext);

  if (!context) {
    throw new Error("Tailwind Context is missing");
  }

  return context;
};

export const TailwindProvider = ({ children }: { children: React.ReactNode }) => {
  const mounted = useMounted();
  const isDesktop = useMediaQuery("(min-width: 768px)") || !mounted;

  return <TailwindContext.Provider value={{ isDesktop }}>{children}</TailwindContext.Provider>;
};

// Is min-width: 768px (md)
export const useIsDesktop = () => useTailwindContext().isDesktop;
