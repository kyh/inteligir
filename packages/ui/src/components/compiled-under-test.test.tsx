// @vitest-environment jsdom
// a component the compiler memoizes wrongly passes every unit test and fails only in the
// built app. jsdom on purpose: the compiler's preset runs in the client environment alone, never a
// node suite's server transform.

import { expect, it } from "vitest";

import { Toaster } from "./sonner";

it("holds the React Compiler's output for @repo/ui's components", () => {
  expect(
    Toaster.toString(),
    "packages/ui's vitest config must run the React Compiler's Babel preset (reactCompilerPreset) over src/",
  ).toContain("react.memo_cache_sentinel");
});
