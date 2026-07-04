import { useEffect, useState } from "react";
import { useTheme } from "@repo/ui/lib/theme";

import { GeometricOrb } from "@repo/ui/components/geometric-orb";

export function HeroOrb() {
  const { resolved } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Default to the dark-mode base before mount (matches the default theme),
  // then track the resolved theme so the orb stays legible on either bg.
  const dark = !mounted || resolved === "dark";
  return <GeometricOrb status="starting" baseColor={dark ? "#eeeeee" : "#0a0a0a"} />;
}
