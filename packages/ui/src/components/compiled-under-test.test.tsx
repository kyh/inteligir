import { expect, test } from "vitest";

import { Toaster } from "./sonner";

test("holds the React Compiler's output for @repo/ui's components", () => {
  expect(
    Toaster.toString(),
    "the ui-dom vitest project must run the React Compiler's Babel preset (reactCompilerPreset) over src/",
  ).toContain("react.memo_cache_sentinel");
});
