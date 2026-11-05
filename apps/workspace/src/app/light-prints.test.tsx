// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { installLightPrints } from "./light-prints";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
});

// a browser's print: the dialog runs inside the call, between the two events
const printLikeABrowser = (during: () => void) =>
  vi.fn(() => {
    window.dispatchEvent(new Event("beforeprint"));
    during();
    window.dispatchEvent(new Event("afterprint"));
  });

describe("a print", () => {
  it("is light whatever the window shows, and the theme comes back after", () => {
    const uninstall = installLightPrints();
    document.documentElement.classList.add("dark");
    let darkDuringPrint: boolean | null = null;
    printLikeABrowser(() => {
      darkDuringPrint = document.documentElement.classList.contains("dark");
    })();
    uninstall();
    expect(darkDuringPrint).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("leaves a light window light", () => {
    const uninstall = installLightPrints();
    printLikeABrowser(() => {})();
    uninstall();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
