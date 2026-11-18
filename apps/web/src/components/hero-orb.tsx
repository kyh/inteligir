"use client";

import dynamic from "next/dynamic";
import { useTheme } from "@repo/ui/lib/theme";

const GeometricOrb = dynamic(
  async () => {
    const { GeometricOrb: orb } = await import("./geometric-orb");

    return orb;
  },
  { ssr: false },
);

export const HeroOrb = () => {
  const { resolved } = useTheme();

  return <GeometricOrb baseColor={resolved === "dark" ? "#eeeeee" : "#0a0a0a"} />;
};
