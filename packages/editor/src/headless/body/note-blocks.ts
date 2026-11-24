import { ElementApi, RangeApi, createSlateEditor, normalizeNodeId } from "platejs";
import type { Descendant } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibrarySection } from "@repo/contract/library/library-nodes";

import { BASE_KIT } from "@repo/editor/headless/kits/base-kit";

import { blockOfElement } from "./element-block";
import { sectionOf, sectioned } from "@repo/editor/headless/kits/note-section";

export const editorValueOf = (blocks: readonly BodyBlock[]) => {
  const elements =
    blocks.length > 0
      ? blocks.map(({ block, section }) => sectioned(block, section))
      : [{ children: [{ text: "" }], section: "note", type: "p" }];

  const editor = createSlateEditor({
    nodeId: true,
    plugins: BASE_KIT,
    value: normalizeNodeId(elements),
  });

  const sources = editor.children.flatMap((node, index) => {
    const range = editor.api.range([index]);

    return range === undefined
      ? []
      : [{ ref: editor.api.rangeRef(range), section: sectionOf(node) }];
  });

  editor.tf.normalize({ force: true });
  const spans = sources.map(({ ref, section }) => ({ range: ref.unref(), section }));
  let section: LibrarySection = "note";

  return editor.children.map((node, index) => {
    const span = spans.find(({ range }) => range !== null && RangeApi.includes(range, [index]));
    section = span?.section ?? section;

    return sectioned(node, section);
  });
};

export const blocksOfValue = (value: readonly Descendant[]) =>
  value.flatMap((node) => {
    if (!ElementApi.isElement(node)) {
      return [] satisfies BodyBlock[];
    }

    const block = blockOfElement(node);

    return (block === null ? [] : [{ block, section: sectionOf(node) }]) satisfies BodyBlock[];
  });
