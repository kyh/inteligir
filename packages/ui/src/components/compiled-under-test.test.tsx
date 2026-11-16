// a component the compiler memoizes wrongly passes every unit test and fails only in the
// built app. a .tsx suite on purpose: only the ui-dom project runs the compiler, which skips the
// node project's server transform.

import { expect, test } from "vitest";

import { Toaster } from "./sonner";

test("holds the React Compiler's output for @repo/ui's components", () => {
  expect(
    Toaster.toString(),
    "the ui-dom vitest project must run the React Compiler's Babel preset (reactCompilerPreset) over src/",
  ).toContain("react.memo_cache_sentinel");
});
