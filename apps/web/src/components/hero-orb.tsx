"use client";

import dynamic from "next/dynamic";
import { useTheme } from "@repo/ui/lib/theme";

// three.js is most of the home page's weight; drawn on the server or imported statically it would
// hold hydration, and the download button with it
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
