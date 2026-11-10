// A top-level block's section: the person's writing, or the page a fill read. The article's blocks
// say so in an attribute of their own, and a block saying nothing is the person's.

import { ElementApi, createSlatePlugin } from "platejs";
import type { Descendant, Path, SlateEditor, TElement } from "platejs";

import { librarySectionSchema } from "@repo/contract/library/library-nodes";
import type { LibrarySection } from "@repo/contract/library/library-nodes";

import { appliesRemoteChange } from "./yjs-binding";

const SECTION_KEY = "section";

export const sectionOf = (element: TElement): LibrarySection =>
  librarySectionSchema.safeParse(element[SECTION_KEY]).data ?? "note";

export const sectioned = (element: TElement, section: LibrarySection): TElement => ({
  ...element,
  [SECTION_KEY]: section,
});

export const setSection = (editor: SlateEditor, at: Path, section: LibrarySection): void => {
  editor.tf.setNodes({ [SECTION_KEY]: section }, { at });
};

const withoutSection = (node: Descendant): Descendant => {
  if (!ElementApi.isElement(node) || !(SECTION_KEY in node)) {
    return node;
  }
  const { [SECTION_KEY]: _, ...rest } = node;
  return rest;
};

// A top-level block a split or an insert makes is the person's, wherever it lands: a line typed
// in the article, or pasted out of it, is their writing, which a refill must never take. A change
// from elsewhere lands as its writer made it, and an undo puts a block back as it was. A writer
// placing an article's block sets its section once it stands (`body-change.ts`).
export const NoteSectionPlugin = createSlatePlugin({ key: "noteSection" }).overrideEditor(
  ({ editor, tf: { apply } }) => ({
    transforms: {
      apply(op) {
        const keeps = appliesRemoteChange(editor) || editor.api.isSaving() === false;
        if (!keeps && op.type === "insert_node" && op.path.length === 1) {
          apply({ ...op, node: withoutSection(op.node) });
          return;
        }
        if (!keeps && op.type === "split_node" && op.path.length === 1) {
          const { [SECTION_KEY]: _, ...properties } = op.properties;
          apply({ ...op, properties });
          return;
        }
        apply(op);
      },
    },
  }),
);
