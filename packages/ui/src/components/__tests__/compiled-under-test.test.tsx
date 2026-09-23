// @vitest-environment jsdom
// a component the compiler memoizes wrongly passes every unit test and fails only in the
// built app. jsdom on purpose: the compiler plugin skips the node suites' server transform.

import { expect, it } from "vitest";

import { Toaster } from "../sonner";

it("holds the React Compiler's output for @repo/ui's components", () => {
  expect(
    Toaster.toString(),
    "packages/ui's vitest config must run @vitejs/plugin-react with the compiler over src/",
  ).toContain("react.memo_cache_sentinel");
});
