// Whether a Plate list node is a genuine todo checkbox (has a `- [ ]` / `- [x]`
// on disk), as opposed to a phantom.
//
// Plate quirk: in a list that mixes todos and plain bullets, a plain bullet
// FOLLOWING a todo inherits `listStyleType: "todo"` but WITHOUT a `checked`
// field. A real todo always carries `checked: boolean` (false for `[ ]`, true
// for `[x]`); a phantom plain bullet has `checked: undefined`. Requiring
// `checked` keeps the renderer's delegation ordinal (block-list.tsx `todoIndex`)
// in lockstep with main's count (find-task-line.ts), which parses the same
// markdown with the same remark-gfm — so delegation never targets a checkbox
// that isn't on disk.
export function isTodoItem(node: unknown): boolean {
  return (
    typeof node === "object" &&
    node !== null &&
    "listStyleType" in node &&
    node.listStyleType === "todo" &&
    "checked" in node &&
    typeof node.checked === "boolean"
  );
}
