import { ElementApi, createSlatePlugin } from "platejs";
import type { Descendant, Path, SlateEditor, SplitNodeOperation, TElement } from "platejs";

import { librarySectionSchema } from "@repo/contract/library/library-nodes";
import type { LibrarySection } from "@repo/contract/library/library-nodes";

import { appliesOwnEdit } from "./own-edit";

const SECTION_KEY = "section";

export const sectionOf = (element: TElement) =>
  (librarySectionSchema.safeParse(element[SECTION_KEY]).data ?? "note") satisfies LibrarySection;

export const sectioned = (element: TElement, section: LibrarySection) =>
  ({
    ...element,
    [SECTION_KEY]: section,
  }) satisfies TElement;

export const setSection = (editor: SlateEditor, at: Path, section: LibrarySection) => {
  editor.tf.setNodes({ [SECTION_KEY]: section }, { at });
};

const withoutSection = (node: Descendant) => {
  if (!ElementApi.isElement(node) || !(SECTION_KEY in node)) {
    return node;
  }

  const { [SECTION_KEY]: _, ...rest } = node;

  return rest;
};

const holdsNothing: (editor: SlateEditor, nodes: readonly Descendant[]) => boolean = (
  editor: SlateEditor,
  nodes: readonly Descendant[],
) =>
  nodes.every((node) =>
    ElementApi.isElement(node)
      ? !editor.api.isVoid(node) && holdsNothing(editor, node.children)
      : node.text === "",
  );

const splitsAtStart = (editor: SlateEditor, { path, position }: SplitNodeOperation) => {
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

export const NoteSectionPlugin = createSlatePlugin({ key: "noteSection" }).overrideEditor(
  ({ editor, tf: { apply } }) => ({
    transforms: {
      apply(op) {
        const own = appliesOwnEdit(editor);

        if (own && op.type === "insert_node" && op.path.length === 1) {
          apply({ ...op, node: withoutSection(op.node) });

          return;
        }

        if (own && op.type === "split_node" && op.path.length === 1) {
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
