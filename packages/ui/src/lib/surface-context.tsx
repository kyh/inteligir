// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import { createContext, useContext, type ReactNode } from "react";

const SurfaceContext = createContext<number>(1);

export function useSurface(): number {
  return useContext(SurfaceContext);
}

export function SurfaceProvider({ value, children }: { value: number; children: ReactNode }) {
  const level = Math.max(1, Math.min(8, value));
  return <SurfaceContext.Provider value={level}>{children}</SurfaceContext.Provider>;
}
