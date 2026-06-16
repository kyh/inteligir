"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Tracks the current elevation level (1–8) so nested surfaces can walk up the
 * ladder automatically. Floating layers (dropdowns, dialogs) read this to pick
 * a background one or more steps above their substrate.
 */
const SurfaceContext = createContext<number>(1);

export function useSurface(): number {
  return useContext(SurfaceContext);
}

export function SurfaceProvider({ value, children }: { value: number; children: ReactNode }) {
  const level = Math.max(1, Math.min(8, value));
  return <SurfaceContext.Provider value={level}>{children}</SurfaceContext.Provider>;
}

/**
 * Marks a subtree as sitting on a smoked-glass surface (dialogs, menus,
 * popovers, the composer). Glass is theme-invariant dark, so the opaque
 * ladder's foreground/border tokens would be unreadable on it — form controls
 * and buttons read this flag to swap to the glass-inner recipe (lighter
 * translucent white pills, white text). Orthogonal to the elevation ladder:
 * glass tiers are picked statically, never by level.
 */
const GlassContext = createContext<boolean>(false);

export function useOnGlass(): boolean {
  return useContext(GlassContext);
}

export function GlassProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <GlassContext.Provider value={value}>{children}</GlassContext.Provider>;
}
