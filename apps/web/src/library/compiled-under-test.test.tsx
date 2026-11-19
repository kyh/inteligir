import { expect, test } from "vitest";

import { RenderCrash } from "./render-crash";

test("holds the React Compiler's output for the page's components", () => {
  expect(
    RenderCrash.toString(),
    "the library-dom vitest project must run the React Compiler's Babel preset (reactCompilerPreset) over src/",
  ).toContain("react.memo_cache_sentinel");
});
