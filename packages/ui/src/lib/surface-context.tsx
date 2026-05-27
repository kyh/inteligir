"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Tracks the current elevation level (1–8) so nested surfaces can walk up the
 * ladder automatically. Floating layers (dropdowns, dialogs) read this to pick
 * a background one or more steps above their substrate. See {@link Elevated}.
 */
const SurfaceContext = createContext<number>(1);

export function useSurface(): number {
  return useContext(SurfaceContext);
}

export function SurfaceProvider({
  value,
  children,
}: {
  value: number;
  children: ReactNode;
}) {
  return (
    <SurfaceContext.Provider value={Math.max(1, Math.min(8, value))}>
      {children}
    </SurfaceContext.Provider>
  );
}
