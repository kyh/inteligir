import { useCallback, useLayoutEffect } from "react";

import { useDiskState } from "@repo/workspace/lib/use-disk-state";
import {
  applyAppearanceSideEffects,
  DEFAULT_APPEARANCE,
  parseAppearance,
  type Appearance,
} from "@repo/workspace/appearance/appearance";

/** One ui-state key holds the whole record — see appearance.ts. */
const APPEARANCE_KEY = "workspace.appearance";

export type AppearanceControls = {
  appearance: Appearance;
  /** Change one or more knobs; everything else keeps its value. */
  setAppearance: (patch: Partial<Appearance>) => void;
  resetAppearance: () => void;
};

export function useAppearance(): AppearanceControls {
  const [appearance, store] = useDiskState<Appearance>(
    APPEARANCE_KEY,
    DEFAULT_APPEARANCE,
    parseAppearance,
  );

  const setAppearance = useCallback(
    (patch: Partial<Appearance>) => store({ ...appearance, ...patch }),
    [appearance, store],
  );
  const resetAppearance = useCallback(() => store(DEFAULT_APPEARANCE), [store]);

  return { appearance, setAppearance, resetAppearance };
}

/**
 * Push the persisted appearance into CSS. Mounted ONCE, at the app root.
 *
 * Hydration, every mutation and the reset are all writes to the same ui-state
 * key, so they all arrive here — which is why `applyAppearanceSideEffects` has
 * exactly one call site and no path can skip it. Layout-effect timing so a
 * change paints in the same frame as the click.
 */
export function useAppearanceSideEffects(): void {
  const { appearance } = useAppearance();
  useLayoutEffect(() => applyAppearanceSideEffects(appearance), [appearance]);
}
