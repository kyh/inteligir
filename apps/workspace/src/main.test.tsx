// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// main.tsx is the whole page and its top-level await, loaded once
const LOADS_THE_PAGE_MS = 60_000;

describe("the tab's open", () => {
  it(
    "says the library didn't open and offers Try again when its session read met no answer",
    async () => {
      document.body.innerHTML = `<div id="root"></div>`;
      vi.stubGlobal("fetch", async () => await Promise.reject(new TypeError("Failed to fetch")));
      await import("./main");
      await screen.findByRole("heading", { name: "Your library didn't open" });
      expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
      vi.unstubAllGlobals();
    },
    LOADS_THE_PAGE_MS,
  );
});
