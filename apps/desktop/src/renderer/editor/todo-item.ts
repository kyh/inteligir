// The renderer's half of the task-ordinal counting contract, React-free so
// the lockstep test (todo-ordinal-lockstep.test.ts) can pin it headless
// against core's `scanTaskItems` — the counting authority the host's
// find-task-line and the guarded toggle already share.

import type { SlateEditor, TElement } from "platejs";

// Whether a Plate list node is a genuine todo checkbox (has a `- [ ]` / `- [x]`
// on disk), as opposed to a phantom.
//
// Plate quirk: in a list that mixes todos and plain bullets, a plain bullet
// FOLLOWING a todo inherits `listStyleType: "todo"` but WITHOUT a `checked`
// field. A real todo always carries `checked: boolean` (false for `[ ]`, true
// for `[x]`); a phantom plain bullet has `checked: undefined`. Requiring
// `checked` keeps the renderer's delegation ordinal (`todoIndex` below) in
// lockstep with core's count (scanTaskItems), which parses the same markdown
// with the same remark-gfm — so delegation never targets a checkbox that
// isn't on disk.
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

/** The checkbox's ordinal — its position among all real todo items in the
 * document, counted over the live Plate tree at click time. Plate's flat list
 * model keeps every todo a TOP-LEVEL block (nesting is an indent prop), so
 * counting `editor.children` covers them all. The host counts the same
 * `- [ ]` / `- [x]` items in the raw markdown (core scanTaskItems, via
 * find-task-line and the guarded toggle), so the two agree by position with
 * no text matching and duplicate labels stay distinct. */
export function todoIndex(editor: SlateEditor, element: TElement): number {
  const path = editor.api.findPath(element);
  const top = path?.[0];
  if (top === undefined) return -1;
  let count = 0;
  for (let i = 0; i < top; i++) {
    if (isTodoItem(editor.children[i])) count++;
  }
  return count;
}
