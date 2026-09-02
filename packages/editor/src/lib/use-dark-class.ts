// For third-party surfaces that bake the theme into their own DOM (mermaid, react-tweet) and cannot follow CSS variables.

import { useEffect, useState } from "react";

function isDarkClass(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function useDarkClass(): boolean {
  const [dark, setDark] = useState(isDarkClass);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDarkClass()));
    observer.observe(document.documentElement, { attributeFilter: ["class"], attributes: true });
    return () => observer.disconnect();
  }, []);
  return dark;
}
