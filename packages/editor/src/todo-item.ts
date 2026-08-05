// The renderer's half of the task-ordinal counting contract, React-free so
// the lockstep test (todo-ordinal-lockstep.test.ts) can pin it headless
// against core's `scanTaskItems` — the counting authority the host's
// find-task-line and the guarded toggle already share.

import { PathApi, type SlateEditor, type TElement } from "platejs";

// Whether a Plate list node is a genuine todo checkbox (has a `- [ ]` / `- [x]`
// on disk), as opposed to a phantom.
//
// Plate quirk: in a list that mixes todos and plain bullets, a plain bullet
// FOLLOWING a todo inherits `listStyleType: "todo"` but WITHOUT a `checked`
// field. A real todo always carries `checked: boolean` (false for `[ ]`, true
// for `[x]`); a phantom plain bullet has `checked: undefined`. Requiring
// `checked` keeps the renderer's delegation ordinal (`todoIndex` below) in
// lockstep with core's count (scanTaskItems), which reads the same markdown
// under the same grammar (the canonical flavor's no-indented-code reading)
// — so delegation never targets a checkbox that isn't on disk.
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
 * document, counted over the live Plate tree at click time. Traversal is
 * whole-document pre-order (`editor.api.nodes`), NOT top-level only: a todo
 * nested inside a container block (blockquote, `[!NOTE]` callout, `<toggle>`)
 * sits at depth ≥ 2, and a top-level-only count would collide it with the
 * next top-level todo — delegating the wrong checkbox. Pre-order over the
 * whole tree visits every todo in document order, matching the host's count
 * of the same `- [ ]` / `- [x]` items in the raw markdown (core
 * `scanTaskItems`, via find-task-line and the guarded toggle), so the two
 * agree by position — no text matching, duplicate labels stay distinct.
 * (The lockstep is pinned by todo-ordinal-lockstep.test.ts.) */
export function todoIndex(editor: SlateEditor, element: TElement): number {
  const targetPath = editor.api.findPath(element);
  if (!targetPath) return -1;
  let count = 0;
  for (const [, path] of editor.api.nodes({ at: [], match: (node) => isTodoItem(node) })) {
    if (PathApi.equals(path, targetPath)) return count;
    count += 1;
  }
  return -1;
}
