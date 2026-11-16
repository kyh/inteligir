// a component the compiler memoizes wrongly passes every unit test and fails only in the
// built app. a .tsx suite on purpose: the compiler runs under jsdom alone, never in a node suite's
// server transform.

import { expect, test } from "vitest";

import { RenderCrash } from "./render-crash";

test("holds the React Compiler's output for the page's components", () => {
  expect(
    RenderCrash.toString(),
    "the library-dom vitest project must run the React Compiler's Babel preset (reactCompilerPreset) over src/",
  ).toContain("react.memo_cache_sentinel");
});
