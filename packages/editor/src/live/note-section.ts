// A top-level block's section: the person's writing, or the page a fill read. The article's blocks
// say so in an attribute of their own, and a block saying nothing is the person's.

import { ElementApi, createSlatePlugin } from "platejs";
import type { Descendant, Path, SlateEditor, SplitNodeOperation, TElement } from "platejs";

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

// an inline void, a mention or a pill, is something a block holds though its text is empty
const holdsNothing = (editor: SlateEditor, nodes: readonly Descendant[]): boolean =>
  nodes.every((node) =>
    ElementApi.isElement(node)
      ? !editor.api.isVoid(node) && holdsNothing(editor, node.children)
      : node.text === "",
  );

// Enter before a block's first word leaves the empty half where the block stood and moves its
// words into the block the split makes; an empty block's split is at its end, where the cursor
// lands in the block the split makes.
const splitsAtStart = (editor: SlateEditor, { path, position }: SplitNodeOperation): boolean => {
  const block = editor.api.node(path)?.[0];
  if (!ElementApi.isElement(block)) {
    return false;
  }
  const { children } = block;
  return (
    holdsNothing(editor, children.slice(0, position)) &&
    !holdsNothing(editor, children.slice(position))
  );
};

// A top-level block a split or an insert makes is the person's, wherever it lands: a line typed
// in the article, or pasted out of it, is their writing, which a refill must never take. A split
// at a block's start makes the person's line of the half left behind instead, so the words keep
// their section. A change from elsewhere lands as its writer made it, and an undo puts a block
// back as it was. A writer placing an article's block sets its section once it stands
// (`body-change.ts`).
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
          const { [SECTION_KEY]: section, ...properties } = op.properties;
          if (section !== undefined && splitsAtStart(editor, op)) {
            apply(op);
            editor.tf.unsetNodes(SECTION_KEY, { at: op.path });
            return;
          }
          apply({ ...op, properties });
          return;
        }
        apply(op);
      },
    },
  }),
);
