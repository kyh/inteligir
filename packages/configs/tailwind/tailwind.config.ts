import type { Config } from "tailwindcss";

import plugin from "tailwindcss/plugin";
import { theme } from "./tokens/theme";
import { colors } from "./tokens/colors";
import { components } from "./tokens/components";
import { effects } from "./tokens/effects";

const customPlugin = plugin(
  ({ addBase, addComponents, config }) => {
    const [darkMode, className = ".dark"] = ([] as string[]).concat(
      config("darkMode", "media"),
    );

    addBase({
      "*": {
        borderColor: "var(--border-base)",
      },
    });

    addComponents(components);

    addBase({
      ":root": { ...colors.light, ...effects.light },
    });

    if (darkMode === "class") {
      addBase({
        [className]: { ...colors.dark, ...effects.dark },
      });
    } else {
      addBase({
        "@media (prefers-color-scheme: dark)": {
          ":root": { ...colors.dark, ...effects.dark },
        },
      });
    }
  },
  {
    theme,
  },
);

const config: Config = {
  darkMode: ["class"],
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
