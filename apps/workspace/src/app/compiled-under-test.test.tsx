// @vitest-environment jsdom
// a component the compiler memoizes wrongly passes every unit test and fails only in the
// built app. jsdom on purpose: the compiler's preset runs in the client environment alone, never a
// node suite's server transform.

import { expect, it } from "vitest";

import { RenderCrash } from "./render-crash";

it("holds the React Compiler's output for the page's components", () => {
  expect(
    RenderCrash.toString(),
    "the desktop vitest project must run the React Compiler's Babel preset (reactCompilerPreset) over src/",
  ).toContain("react.memo_cache_sentinel");
});
