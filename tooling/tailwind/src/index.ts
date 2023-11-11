import type { Config } from "tailwindcss";

import plugin from "tailwindcss/plugin";
import { theme } from "./tokens/theme";
import { colors } from "./tokens/colors";
import { components } from "./tokens/components";
import { effects } from "./tokens/effects";

const customPlugin = plugin(
  ({ addBase }) => {
    addBase({
      ":root": { ...colors.light, ...effects.light },
    });

    addBase({
      '.dark, [data-mode="dark"]': { ...colors.dark, ...effects.dark },
    });

    addBase({
      "*": {
        borderColor: "var(--border-base)",
      },
      ...components,
    });
  },
  {
    theme,
  },
);

const config: Config = {
  darkMode: "class",
  content: [],
  plugins: [customPlugin, require("tailwindcss-animate")],
};

export default config;
