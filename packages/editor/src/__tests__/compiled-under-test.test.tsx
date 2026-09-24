// a component the compiler memoizes wrongly passes every unit test and fails only in the
// built app. a .tsx suite on purpose: only the editor-dom project runs the compiler, which skips
// the node project's server transform.

import { expect, it } from "vitest";

import { HrElement } from "../nodes/hr-node";

it("holds the React Compiler's output for the editor's components", () => {
  expect(
    HrElement.toString(),
    "the editor-dom vitest project must run @vitejs/plugin-react with the compiler over src/",
  ).toContain("react.memo_cache_sentinel");
});
