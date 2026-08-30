import { useSyncExternalStore } from "react";
import { useTheme } from "@repo/ui/lib/theme";

import { GeometricOrb } from "./geometric-orb";

// Hydration gate: false through the server render and the hydrating one, true
// from the first client render on. There is nothing to subscribe to — the
// snapshot pair *is* the signal — so subscribe hands back a no-op unsubscribe.
const neverChanges = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function HeroOrb() {
  const { resolved } = useTheme();
  const mounted = useSyncExternalStore(neverChanges, onClient, onServer);

  // Default to the dark-mode base before mount (matches the default theme),
  // then track the resolved theme so the orb stays legible on either bg.
  const dark = !mounted || resolved === "dark";
  return <GeometricOrb baseColor={dark ? "#eeeeee" : "#0a0a0a"} />;
}
