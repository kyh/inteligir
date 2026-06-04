import { useEffect, useState } from "react";

import { GeometricOrb } from "@repo/ui/components/geometric-orb";

export function HeroOrb() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return <GeometricOrb status="starting" baseColor={isDark ? "#eeeeee" : "#0a0a0a"} />;
}
