// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type SurfaceLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const isSurfaceLevel = (level: number): level is SurfaceLevel =>
  Number.isInteger(level) && level >= 1 && level <= 8;

// round after clamping so a fractional level cannot miss the lookup; the final fallback is
// unreachable but the guard cannot prove that
const clampSurfaceLevel = (level: number): SurfaceLevel => {
  const clamped = Math.round(Math.max(1, Math.min(8, level)));
  return isSurfaceLevel(clamped) ? clamped : 1;
};

const SurfaceContext = createContext<SurfaceLevel>(1);

export const useRaisedSurface = (offset: number): SurfaceLevel =>
  clampSurfaceLevel(useContext(SurfaceContext) + offset);

export const SurfaceProvider = ({
  value,
  children,
}: {
  value: SurfaceLevel;
  children: ReactNode;
}) => <SurfaceContext.Provider value={value}>{children}</SurfaceContext.Provider>;
