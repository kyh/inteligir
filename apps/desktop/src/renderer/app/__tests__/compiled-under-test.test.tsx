// @vitest-environment jsdom
// The suites run the React Compiler's OUTPUT — the code the renderer bundle
// ships — or a component the compiler memoizes wrongly passes every unit test
// and fails only in the built app. A compiled component reads its memo cache
// against React's own sentinel, so the function's source as loaded here
// carries that spelling. A jsdom suite on purpose: the compiler plugin skips
// the node suites' server transform.

import { expect, it } from "vitest";

import { RenderCrash } from "../render-crash";

it("holds the React Compiler's output for the renderer's components", () => {
  expect(
    RenderCrash.toString(),
    "the desktop vitest project must run @vitejs/plugin-react with the compiler over src/",
  ).toContain("react.memo_cache_sentinel");
});
