// The editor's half of the task-ordinal counting contract, React-free so
// the lockstep test (todo-ordinal-lockstep.test.ts) can pin it headless
// against core's `scanTaskItems` — the counting authority every other surface
// resolves through (@repo/notes/knowledge/task-ordinal).

import { PathApi, type SlateEditor, type TElement } from "platejs";

import { scanTaskItems } from "@repo/notes/knowledge/task-ordinal";

// Whether a Plate list node is a genuine todo checkbox (has a `- [ ]` / `- [x]`
// on disk), as opposed to a phantom.
//
// Plate quirk: in a list that mixes todos and plain bullets, a plain bullet
// FOLLOWING a todo inherits `listStyleType: "todo"` but WITHOUT a `checked`
// field. A real todo always carries `checked: boolean` (false for `[ ]`, true
// for `[x]`); a phantom plain bullet has `checked: undefined`. Requiring
// `checked` keeps the editor's delegation ordinal (`todoIndex` below) in
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

// A checkbox can also sit INSIDE an opaque block — `<Steps>` holding a `- [ ]`
// is one string to this editor, but core's source-side scan reads the list
// underneath it and counts the task. The ordinal is a position in the SOURCE,
// so those hidden tasks have to be counted here too or every later checkbox is
// off by one and Delegate edits the wrong line. Only the BLOCK half counts:
// an inline opaque (an html comment, `<kbd>`) is phrasing on both sides, and
// scanning its string would invent tasks core never sees.
function hiddenTaskCount(node: unknown): number {
  if (typeof node !== "object" || node === null) return 0;
  if (!("type" in node) || node.type !== "opaqueBlock") return 0;
  return "value" in node && typeof node.value === "string" ? scanTaskItems(node.value).length : 0;
}

/** The checkbox's ordinal — its position among all real todo items in the
 * document, counted over the live Plate tree at click time. Traversal is
 * whole-document pre-order (`editor.api.nodes`), NOT top-level only: a todo
 * nested inside a container block (blockquote, `[!NOTE]` callout, `<toggle>`)
 * sits at depth ≥ 2, and a top-level-only count would collide it with the
 * next top-level todo — delegating the wrong checkbox. Pre-order over the
 * whole tree visits every todo in document order, matching the host's count
 * of the same `- [ ]` / `- [x]` items in the raw markdown (core
 * `scanTaskItems`, which the anchor and the guarded toggle share), so the two
 * agree by position — no text matching, duplicate labels stay distinct.
 * (The lockstep is pinned by todo-ordinal-lockstep.test.ts.) */
export function todoIndex(editor: SlateEditor, element: TElement): number {
  const targetPath = editor.api.findPath(element);
  if (!targetPath) return -1;
  let count = 0;
  for (const [node, path] of editor.api.nodes({
    at: [],
    match: (candidate) => isTodoItem(candidate) || hiddenTaskCount(candidate) > 0,
  })) {
    if (PathApi.equals(path, targetPath)) return count;
    count += isTodoItem(node) ? 1 : hiddenTaskCount(node);
  }
  return -1;
}
