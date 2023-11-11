export const components = {
  ".spinner-line": {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    animationDuration: "1s",
    borderLeftWidth: "3px",
    borderTopWidth: "3px",
    borderLeftColor: "var(--spinner-color, #fff)",
    borderLeftStyle: "solid",
    borderTopStyle: "solid",
    borderTopColor: "transparent",
  },
  ".atom-spinner-line-1": {
    transform: "rotateZ(120deg) rotateX(66deg) rotateZ(0deg)",
  },
  ".atom-spinner-line-2": {
    transform: "rotateZ(240deg) rotateX(66deg) rotateZ(0deg)",
  },
  ".atom-spinner-line-3": {
    transform: "rotateZ(360deg) rotateX(66deg) rotateZ(0deg)",
  },
  ".button-inverted-gradient": {
    backgroundImage:
      "linear-gradient(180deg, var(--button-inverted-gradient-from), var(--button-inverted-gradient-to))",
    opacity: "16%",
  },
  ".button-neutral-pressed-gradient": {
    backgroundImage:
      "linear-gradient(180deg, var(--button-neutral-pressed-gradient-from), var(--button-neutral-pressed-gradient-to))",
    opacity: "3%",
  },
  ".button-neutral-gradient": {
    backgroundImage:
      "linear-gradient(180deg, var(--button-neutral-gradient-from), var(--button-neutral-gradient-to))",
    opacity: "3%",
  },
  ".button-neutral-hover-gradient": {
    backgroundImage:
      "linear-gradient(180deg, var(--button-neutral-hover-gradient-from), var(--button-neutral-hover-gradient-to))",
    opacity: "3%",
  },
  ".button-danger-gradient": {
    backgroundImage:
      "linear-gradient(180deg, var(--button-danger-gradient-from), var(--button-danger-gradient-to))",
    opacity: "16%",
  },
  ".button-inverted-pressed-gradient": {
    backgroundImage:
      "linear-gradient(180deg, var(--button-inverted-pressed-gradient-from), var(--button-inverted-pressed-gradient-to))",
    opacity: "16%",
  },
  ".button-danger-pressed-gradient": {
    backgroundImage:
      "linear-gradient(180deg, var(--button-danger-pressed-gradient-from), var(--button-danger-pressed-gradient-to))",
    opacity: "16%",
  },
  ".button-inverted-hover-gradient": {
    backgroundImage:
      "linear-gradient(180deg, var(--button-inverted-hover-gradient-from), var(--button-inverted-hover-gradient-to))",
    opacity: "16%",
  },
  ".button-danger-hover-gradient": {
    backgroundImage:
      "linear-gradient(180deg, var(--button-danger-hover-gradient-from), var(--button-danger-hover-gradient-to))",
    opacity: "16%",
  },
};
