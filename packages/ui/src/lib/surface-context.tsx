"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

const SurfaceContext = createContext<number>(1);

export function useSurface(): number {
  return useContext(SurfaceContext);
}

export function SurfaceProvider({ value, children }: { value: number; children: ReactNode }) {
  const clamped = useMemo(() => Math.max(1, Math.min(8, value)), [value]);
  return <SurfaceContext.Provider value={clamped}>{children}</SurfaceContext.Provider>;
}
