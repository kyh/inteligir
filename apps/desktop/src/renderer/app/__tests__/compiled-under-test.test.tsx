// @vitest-environment jsdom
// a component the compiler memoizes wrongly passes every unit test and fails only in the
// built app. jsdom on purpose: the compiler plugin skips the node suites' server transform.

import { expect, it } from "vitest";

import { RenderCrash } from "../render-crash";

it("holds the React Compiler's output for the renderer's components", () => {
  expect(
    RenderCrash.toString(),
    "the desktop vitest project must run @vitejs/plugin-react with the compiler over src/",
  ).toContain("react.memo_cache_sentinel");
});
