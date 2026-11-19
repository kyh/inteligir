import { expect, test } from "vitest";

import { HrElement } from "./hr-node";

test("holds the React Compiler's output for the editor's components", () => {
  expect(
    HrElement.toString(),
    "the editor-dom vitest project must run the React Compiler's Babel preset (reactCompilerPreset) over src/",
  ).toContain("react.memo_cache_sentinel");
});
