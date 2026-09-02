import { useSyncExternalStore } from "react";
import { useTheme } from "@repo/ui/lib/theme";

import { GeometricOrb } from "./geometric-orb";

// hydration gate: the server snapshot is false, the client snapshot true; nothing to subscribe to
const neverChanges = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function HeroOrb() {
  const { resolved } = useTheme();
  const mounted = useSyncExternalStore(neverChanges, onClient, onServer);

  // dark before mount matches the default theme, so hydration does not flip the color
  const dark = !mounted || resolved === "dark";
  return <GeometricOrb baseColor={dark ? "#eeeeee" : "#0a0a0a"} />;
}
