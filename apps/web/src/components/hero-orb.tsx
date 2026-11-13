import { useTheme } from "@repo/ui/lib/theme";

import { GeometricOrb } from "./geometric-orb";

export const HeroOrb = () => {
  const { resolved } = useTheme();
  return <GeometricOrb baseColor={resolved === "dark" ? "#eeeeee" : "#0a0a0a"} />;
};
