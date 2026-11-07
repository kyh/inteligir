// A print is light whatever the window shows: a printer skips backgrounds, so the dark theme's light
// ink would land on white paper. The browser fires `beforeprint` before it lays a print out and
// `afterprint` once it is done, so the theme steps aside between the two, however the print began.

export const installLightPrints = (): (() => void) => {
  const root = document.documentElement;
  let wasDark = false;
  const before = (): void => {
    wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
  };
  const after = (): void => {
    if (wasDark) {
      root.classList.add("dark");
    }
  };
  window.addEventListener("beforeprint", before);
  window.addEventListener("afterprint", after);
  return () => {
    window.removeEventListener("beforeprint", before);
    window.removeEventListener("afterprint", after);
  };
};
