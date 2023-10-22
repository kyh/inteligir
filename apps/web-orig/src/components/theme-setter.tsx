"use client";

import { useEffect } from "react";
import isBrowser from "@/lib/generic/is-browser";
import { loadSelectedTheme } from "@/lib/theming";
import configuration from "~/configuration";

const ThemeSetter = () => {
  useEffect(() => {
    if (isBrowser() && configuration.enableThemeSwitcher) {
      loadSelectedTheme();
    }
  }, []);

  return null;
};

export default ThemeSetter;
