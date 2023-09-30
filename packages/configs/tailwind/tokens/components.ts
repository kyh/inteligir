export const components = {
  // Button
  ".button-inverted-gradient": {
    backgroundImage:
      "linear-gradient(0deg, var(--button-inverted-gradient-from), var(--button-inverted-gradient-to))",
    opacity: "12%",
  },
  ".button-danger-gradient": {
    backgroundImage:
      "linear-gradient(0deg, var(--button-danger-gradient-from), var(--button-danger-gradient-to))",
    opacity: "16%",
  },
  ".button-neutral-gradient": {
    backgroundImage:
      "linear-gradient(0deg, var(--button-neutral-gradient-from), var(--button-neutral-gradient-to))",
    opacity: "6%",
  },
  // Spinner
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
};
