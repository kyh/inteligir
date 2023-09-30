import type { Config } from "tailwindcss";

import plugin from "tailwindcss/plugin";
import { theme } from "./tokens/theme";
import { colors } from "./tokens/colors";
import { components } from "./tokens/components";
import { effects } from "./tokens/effects";

const customPlugin = plugin(
  ({ addBase, addComponents }) => {
    addBase({
      "*": {
        borderColor: "var(--border-base)",
      },
    });

    addComponents(components);

    addBase({
      ":root": { ...colors.light, ...effects.light },
    });

    addBase({
      '.dark, [data-mode="dark"]': { ...colors.dark, ...effects.dark },
    });
  },
  {
    theme,
  },
);

const config: Config = {
  darkMode: "class",
  content: [],
  plugins: [
    customPlugin,
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
    require("@tailwindcss/forms"),
    require("@tailwindcss/aspect-ratio"),
  ],
};

export default config;
