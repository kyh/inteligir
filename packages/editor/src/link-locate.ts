// A wiki chip is an inline void: its label lives in a prop, not in a text node, so the find
// bar cannot land on it. A problem row names the written target, and this walks the
// document for the element that carries it.

import { ElementApi, KEYS, type SlateEditor, type TElement } from "platejs";

import { WikiLinkBaseKit } from "@repo/editor/kits/wiki-link-kit";
import { stringProp } from "@repo/editor/node-props";
import { parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";

const WIKI_TYPES = new Set<string>(WikiLinkBaseKit.map((plugin) => plugin.key));

// the written target of a link element, as the knowledge scan stores it: a wiki body's
// target, or an md/image url without its anchor
function writtenTarget(editor: SlateEditor, element: TElement): string | null {
  if (WIKI_TYPES.has(element.type)) {
    const body = stringProp(element, "body");
    return body === undefined ? null : parseWikiBody(body).target;
  }
  if (element.type === editor.getType(KEYS.link) || element.type === editor.getType(KEYS.img)) {
    const url = stringProp(element, "url");
    if (url === undefined) return null;
    const hash = url.indexOf("#");
    return hash === -1 ? url : url.slice(0, hash);
  }
  return null;
}

// selects and scrolls to the first link element written against `target`; false when none is
export function scrollToLinkTarget(editor: SlateEditor, target: string): boolean {
  const wanted = target.toLowerCase();
  for (const [node, path] of editor.api.nodes({
    at: [],
    match: (candidate) => ElementApi.isElement(candidate),
  })) {
    if (!ElementApi.isElement(node)) continue;
    const written = writtenTarget(editor, node);
    if (written === null || written.toLowerCase() !== wanted) continue;
    editor.tf.select(path);
    try {
      editor.api.toDOMNode(node)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      // the element is not mounted yet; the selection still moves there
    }
    return true;
  }
  return false;
}
