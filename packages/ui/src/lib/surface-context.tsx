// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type SurfaceLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const isSurfaceLevel = (level: number): level is SurfaceLevel =>
  Number.isInteger(level) && level >= 1 && level <= 8;

const clampSurfaceLevel = (level: number) => {
  const clamped = Math.round(Math.max(1, Math.min(8, level)));

  return (isSurfaceLevel(clamped) ? clamped : 1) satisfies SurfaceLevel;
};

const SurfaceContext = createContext<SurfaceLevel>(1);

export const useRaisedSurface = (offset: number) =>
  clampSurfaceLevel(useContext(SurfaceContext) + offset);

export const SurfaceProvider = ({
  value,
  children,
}: {
  value: SurfaceLevel;
  children: ReactNode;
}) => <SurfaceContext value={value}>{children}</SurfaceContext>;
