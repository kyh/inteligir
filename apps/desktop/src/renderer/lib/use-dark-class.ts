// Reactive "is the `.dark` class on <html>" — for third-party surfaces that
// bake the theme into their own DOM (mermaid renders themed SVGs, react-tweet
// reads a data-theme attribute) and can't follow CSS variables. useTheme()
// owns the class toggle; a MutationObserver on the root keeps consumers in
// sync without threading theme context through the editor node tree.

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
