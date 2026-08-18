// "Did that insertion produce the construct it claimed?" — asked of the
// editor's OWN grammar rather than of the string it wrote. A host injecting a
// vocabulary of markdown snippets (the slash menu's items) has no other
// honest way to check: a string compare re-states the snippet instead of
// parsing it, and would keep passing after a syntax extension was dropped
// from `markdownEditorExtensions`.

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { markdownEditorExtensions } from "../markdown-editor-extensions";

/** One of the document's own top-level blocks. */
export interface TopLevelBlock {
  name: string;
  from: number;
  to: number;
}

/** The document's top-level blocks in order — the answer to "did the text
 *  after this construct start its own block, or did the construct swallow
 *  it?", which a name set alone cannot give. */
export function topLevelBlocks(doc: string): TopLevelBlock[] {
  const state = EditorState.create({ doc, extensions: [markdownEditorExtensions()] });
  const tree = ensureSyntaxTree(state, doc.length, 10_000);
  const blocks: TopLevelBlock[] = [];
  for (let child = tree?.topNode.firstChild ?? null; child !== null; child = child.nextSibling) {
    blocks.push({ name: child.name, from: child.from, to: child.to });
  }
  return blocks;
}

/** Every node name the live-preview grammar finds in `doc`. */
export function parsedNodeNames(doc: string): Set<string> {
  const state = EditorState.create({ doc, extensions: [markdownEditorExtensions()] });
  const tree = ensureSyntaxTree(state, doc.length, 10_000);
  const names = new Set<string>();
  tree?.iterate({
    enter: (node) => {
      names.add(node.name);
    },
  });
  return names;
}
