import { fontFamily } from "tailwindcss/defaultTheme";

const FONT_FAMILY_DISPLAY = ["Syne", ...fontFamily.sans];
const FONT_FAMILY_SANS = ["Inter", ...fontFamily.sans];
const FONT_FAMILY_MONO = ["Roboto Mono", ...fontFamily.mono];

export const theme = {
  extend: {
    fontFamily: {
      display: FONT_FAMILY_DISPLAY,
      sans: FONT_FAMILY_SANS,
      mono: FONT_FAMILY_MONO,
    },
    transitionProperty: {
      fg: "color, background-color, border-color, box-shadow",
    },
    keyframes: {
      "accordion-down": {
        from: { height: "0px" },
        to: { height: "var(--radix-accordion-content-height)" },
      },
      "accordion-up": {
        from: { height: "var(--radix-accordion-content-height)" },
        to: { height: "0px" },
      },
      "atom-spinner-animation-1": {
        to: { transform: "rotateZ(120deg) rotateX(66deg) rotateZ(360deg)" },
      },
      "atom-spinner-animation-2": {
        to: { transform: "rotateZ(240deg) rotateX(66deg) rotateZ(360deg)" },
      },
      "atom-spinner-animation-3": {
        to: { transform: "rotateZ(360deg) rotateX(66deg) rotateZ(360deg)" },
      },
    },
    animation: {
      "accordion-down": "accordion-down 0.2s ease-out",
      "accordion-up": "accordion-up 0.2s ease-out",
      "atom-spinner-animation-1":
        "atom-spinner-animation-1 1.2s linear infinite",
      "atom-spinner-animation-2":
        "atom-spinner-animation-2 1.2s linear infinite",
      "atom-spinner-animation-3":
        "atom-spinner-animation-3 1.2s linear infinite",
    },
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
    colors: {
      ui: {
        button: {
          inverted: {
            DEFAULT: "var(--button-inverted)",
            hover: {
              DEFAULT: "var(--button-inverted-hover)",
            },
            pressed: {
              DEFAULT: "var(--button-inverted-pressed)",
            },
          },
          transparent: {
            DEFAULT: "var(--button-transparent)",
            hover: {
              DEFAULT: "var(--button-transparent-hover)",
            },
            pressed: {
              DEFAULT: "var(--button-transparent-pressed)",
            },
          },
          danger: {
            pressed: {
              DEFAULT: "var(--button-danger-pressed)",
            },
            DEFAULT: "var(--button-danger)",
            hover: {
              DEFAULT: "var(--button-danger-hover)",
            },
          },
          neutral: {
            pressed: {
              DEFAULT: "var(--button-neutral-pressed)",
            },
            DEFAULT: "var(--button-neutral)",
            hover: {
              DEFAULT: "var(--button-neutral-hover)",
            },
          },
        },
        code: {
          text: {
            base: {
              DEFAULT: "var(--code-text-base)",
            },
            subtle: {
              DEFAULT: "var(--code-text-subtle)",
            },
          },
          bg: {
            base: {
              DEFAULT: "var(--code-bg-base)",
            },
            header: {
              DEFAULT: "var(--code-bg-header)",
            },
          },
          border: {
            DEFAULT: "var(--code-border)",
          },
          icon: {
            DEFAULT: "var(--code-icon)",
          },
        },
        tag: {
          green: {
            bg: {
              DEFAULT: "var(--tag-green-bg)",
              hover: {
                DEFAULT: "var(--tag-green-bg-hover)",
              },
            },
            icon: {
              DEFAULT: "var(--tag-green-icon)",
            },
            border: {
              DEFAULT: "var(--tag-green-border)",
            },
            text: {
              DEFAULT: "var(--tag-green-text)",
            },
          },
          neutral: {
            bg: {
              DEFAULT: "var(--tag-neutral-bg)",
              hover: {
                DEFAULT: "var(--tag-neutral-bg-hover)",
              },
            },
            border: {
              DEFAULT: "var(--tag-neutral-border)",
            },
            text: {
              DEFAULT: "var(--tag-neutral-text)",
            },
            icon: {
              DEFAULT: "var(--tag-neutral-icon)",
            },
          },
          red: {
            bg: {
              DEFAULT: "var(--tag-red-bg)",
              hover: {
                DEFAULT: "var(--tag-red-bg-hover)",
              },
            },
            icon: {
              DEFAULT: "var(--tag-red-icon)",
            },
            text: {
              DEFAULT: "var(--tag-red-text)",
            },
            border: {
              DEFAULT: "var(--tag-red-border)",
            },
          },
          orange: {
            bg: {
              DEFAULT: "var(--tag-orange-bg)",
              hover: {
                DEFAULT: "var(--tag-orange-bg-hover)",
              },
            },
            icon: {
              DEFAULT: "var(--tag-orange-icon)",
            },
            text: {
              DEFAULT: "var(--tag-orange-text)",
            },
            border: {
              DEFAULT: "var(--tag-orange-border)",
            },
          },
          purple: {
            bg: {
              hover: {
                DEFAULT: "var(--tag-purple-bg-hover)",
              },
              DEFAULT: "var(--tag-purple-bg)",
            },
            text: {
              DEFAULT: "var(--tag-purple-text)",
            },
            icon: {
              DEFAULT: "var(--tag-purple-icon)",
            },
            border: {
              DEFAULT: "var(--tag-purple-border)",
            },
          },
          blue: {
            border: {
              DEFAULT: "var(--tag-blue-border)",
            },
            bg: {
              DEFAULT: "var(--tag-blue-bg)",
              hover: {
                DEFAULT: "var(--tag-blue-bg-hover)",
              },
            },
            icon: {
              DEFAULT: "var(--tag-blue-icon)",
            },
            text: {
              DEFAULT: "var(--tag-blue-text)",
            },
          },
        },
        border: {
          strong: {
            DEFAULT: "var(--border-strong)",
          },
          interactive: {
            DEFAULT: "var(--border-interactive)",
          },
          base: {
            DEFAULT: "var(--border-base)",
          },
          error: {
            DEFAULT: "var(--border-error)",
          },
          loud: {
            DEFAULT: "var(--border-loud)",
          },
          danger: {
            DEFAULT: "var(--border-danger)",
          },
          transparent: {
            DEFAULT: "var(--border-transparent)",
          },
        },
        bg: {
          highlight: {
            DEFAULT: "var(--bg-highlight)",
            hover: {
              DEFAULT: "var(--bg-highlight-hover)",
            },
          },
          base: {
            hover: {
              DEFAULT: "var(--bg-base-hover)",
            },
            DEFAULT: "var(--bg-base)",
            pressed: {
              DEFAULT: "var(--bg-base-pressed)",
            },
          },
          subtle: {
            DEFAULT: "var(--bg-subtle)",
            pressed: {
              DEFAULT: "var(--bg-subtle-pressed)",
            },
            hover: {
              DEFAULT: "var(--bg-subtle-hover)",
            },
          },
          component: {
            DEFAULT: "var(--bg-component)",
          },
          overlay: {
            DEFAULT: "var(--bg-overlay)",
          },
          switch: {
            off: {
              DEFAULT: "var(--bg-switch-off)",
              hover: {
                DEFAULT: "var(--bg-switch-off-hover)",
              },
            },
          },
          field: {
            hover: {
              DEFAULT: "var(--bg-field-hover)",
            },
            DEFAULT: "var(--bg-field)",
          },
          interactive: {
            DEFAULT: "var(--bg-interactive)",
          },
          disabled: {
            DEFAULT: "var(--bg-disabled)",
          },
        },
        fg: {
          on: {
            inverted: {
              DEFAULT: "var(--fg-on-inverted)",
            },
            color: {
              DEFAULT: "var(--fg-on-color)",
            },
          },
          interactive: {
            hover: {
              DEFAULT: "var(--fg-interactive-hover)",
            },
            DEFAULT: "var(--fg-interactive)",
          },
          error: {
            DEFAULT: "var(--fg-error)",
          },
          base: {
            DEFAULT: "var(--fg-base)",
          },
          disabled: {
            DEFAULT: "var(--fg-disabled)",
          },
          subtle: {
            DEFAULT: "var(--fg-subtle)",
          },
          muted: {
            DEFAULT: "var(--fg-muted)",
          },
        },
      },
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
      "elevation-flyout": "var(--elevation-flyout)",
      "elevation-tooltip": "var(--elevation-tooltip)",
      "elevation-card-rest": "var(--elevation-card-rest)",
      "borders-focus": "var(--borders-focus)",
      "borders-interactive": "var(--borders-interactive)",
      "borders-active": "var(--borders-active)",
      "details-contrast-on-bg-interactive":
        "var(--details-contrast-on-bg-interactive)",
      "borders-error": "var(--borders-error)",
      "borders-interactive-with-focus": "var(--borders-interactive-with-focus)",
      "details-switch-handle": "var(--details-switch-handle)",
      "details-switch-background-focus":
        "var(--details-switch-background-focus)",
      "borders-base": "var(--borders-base)",
      "borders-interactive-with-shadow":
        "var(--borders-interactive-with-shadow)",
      "elevation-card-hover": "var(--elevation-card-hover)",
      "elevation-modal": "var(--elevation-modal)",
      "buttons-neutral": "var(--buttons-neutral)",
      "buttons-colored-focus": "var(--buttons-colored-focus)",
      "buttons-colored": "var(--buttons-colored)",
      "buttons-neutral-focus": "var(--buttons-neutral-focus)",
      "borders-base-with-shadow": "var(--borders-base-with-shadow)",
      "borders-strong-with-shadow": "var(--borders-strong-with-shadow)",
      "details-switch-background": "var(--details-switch-background)",
      big: "0px 7px 32px rgb(0 0 0 / 35%);",
      massive:
        "0px 64px 64px rgba(0, 0, 0, 0.25), 0px 32px 32px rgba(0, 0, 0, 0.25), 0px 16px 16px rgba(0, 0, 0, 0.25), 0px 8px 8px rgba(0, 0, 0, 0.25), 0px 4px 4px rgba(0, 0, 0, 0.25);",
    },
  },
};
