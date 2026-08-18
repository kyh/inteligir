// "Did that insertion produce the construct it claimed?" — asked of the
// editor's OWN grammar rather than of the string it wrote. A host injecting a
// vocabulary of markdown snippets (the slash menu's items) has no other
// honest way to check: a string compare re-states the snippet instead of
// parsing it, and would keep passing after a syntax extension was dropped
// from `markdownEditorExtensions`.

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { markdownEditorExtensions } from "../markdown-editor-extensions";

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
