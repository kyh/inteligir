import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  darkMode: ["class"],
  content: ["src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    screens: {
      sm: "540px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      fontFamily: {
        display: ["Syne", ...defaultTheme.fontFamily.sans],
        sans: ["Figtree", ...defaultTheme.fontFamily.sans],
        mono: ["Syne Mono", ...defaultTheme.fontFamily.mono],
      },
      colors: {
        brand: {
          50: "hsla(0, 0%, 95%, 1)",
          100: "hsla(0, 0%, 89%, 1)",
          200: "hsla(0, 0%, 78%, 1)",
          300: "hsla(0, 0%, 67%, 1)",
          400: "hsla(0, 0%, 56%, 1)",
          500: "hsla(0, 0%, 45%, 1)",
          600: "hsla(0, 0%, 34%, 1)",
          700: "hsla(0, 0%, 24%, 1)",
          800: "hsla(0, 0%, 13%, 1)",
          900: "hsla(0, 0%, 1%, 1)",
          950: "hsla(0, 0%, 1%, 1)",
        },
      },
      boxShadow: {
        big: "0px 7px 32px rgb(0 0 0 / 35%);",
        massive:
          "0px 64px 64px rgba(0, 0, 0, 0.25), 0px 32px 32px rgba(0, 0, 0, 0.25), 0px 16px 16px rgba(0, 0, 0, 0.25), 0px 8px 8px rgba(0, 0, 0, 0.25), 0px 4px 4px rgba(0, 0, 0, 0.25);",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
    require("@tailwindcss/forms"),
    require("@tailwindcss/aspect-ratio"),
  ],
};
export default config;
