// A pill as a node of the editor's value: its own fields decoded once, every pill of a note in
// reading order, and what each of them shows.

import { ElementApi } from "platejs";
import type { Descendant, Path, TElement, TNode } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { storableBlockSchema } from "@repo/contract/library/library-nodes";

import { FORMULA_PILL_KEY } from "@repo/editor/headless/dialect-node-keys";
import { displaysOf } from "@repo/editor/headless/formulas/displays";
import type { Pill } from "@repo/editor/headless/formulas/displays";
import { stringProp } from "@repo/editor/headless/node-props";

export const isFormulaPill = (node: TNode): node is TElement =>
  ElementApi.isElement(node) && node.type === FORMULA_PILL_KEY;

export const pillOf = (node: TElement): Pill => ({
  name: stringProp(node, "name"),
  source: stringProp(node, "source") ?? "",
});

export interface PillEntry {
  readonly node: TElement;
  readonly at: Path;
}

// every pill under `nodes` in reading order, each with its path from them
export const pillEntries = (nodes: readonly Descendant[], above: Path = []): PillEntry[] =>
  nodes.flatMap((node, index): PillEntry[] => {
    if (!ElementApi.isElement(node)) {
      return [];
    }
    const at = [...above, index];
    return node.type === FORMULA_PILL_KEY ? [{ at, node }] : pillEntries(node.children, at);
  });

// the pills among them whose display is not the one their sources give, each with the one they do
export const unsettledPills = (
  nodes: readonly Descendant[],
): (PillEntry & { readonly display: string })[] => {
  const entries = pillEntries(nodes);
  const displays = displaysOf(entries.map(({ node }) => pillOf(node)));
  return entries.flatMap((entry, index) => {
    const display = displays[index];
    return display === undefined || display === stringProp(entry.node, "display")
      ? []
      : [{ ...entry, display }];
  });
};

// `node`, each pill under it that `displays` names showing the display named for it
const withDisplays = (node: TElement, displays: ReadonlyMap<TElement, string>): TElement => {
  const display = displays.get(node);
  return display === undefined
    ? {
        ...node,
        children: node.children.map((child) =>
          ElementApi.isElement(child) ? withDisplays(child, displays) : child,
        ),
      }
    : { ...node, display };
};

// each of `blocks` holding a pill whose display moves, by its index, with every pill showing what
// its source gives among them alone
const settledByIndex = (blocks: readonly TElement[]): ReadonlyMap<number, TElement> => {
  const unsettled = unsettledPills(blocks);
  const displays = new Map(unsettled.map(({ node, display }) => [node, display]));
  const settled = new Map<number, TElement>();
  for (const { at } of unsettled) {
    const [index] = at;
    const block = index === undefined ? undefined : blocks[index];
    if (index !== undefined && block !== undefined && !settled.has(index)) {
      settled.set(index, withDisplays(block, displays));
    }
  }
  return settled;
};

// `blocks` with each pill showing what its source gives among them alone: a whole body read from
// markdown, or blocks moved into a note of their own, which no editor's normalizer has seen
export const settledAlone = (blocks: readonly TElement[]): readonly TElement[] => {
  const settled = settledByIndex(blocks);
  return settled.size === 0 ? blocks : blocks.map((block, index) => settled.get(index) ?? block);
};

// A new item's body as a caller sent it, each pill showing what its source gives among the item's,
// since no editor settled it and a caller's display is nobody's word. Only a block whose display
// moved is rebuilt, so nothing else of the body changes; null when one of them grew past what a
// block holds.
export const settledBody = (body: readonly BodyBlock[]): readonly BodyBlock[] | null => {
  const settled = settledByIndex(body.map(({ block }) => block));
  if (settled.size === 0) {
    return body;
  }
  const blocks: BodyBlock[] = [];
  for (const [index, held] of body.entries()) {
    const element = settled.get(index);
    if (element === undefined) {
      blocks.push(held);
      continue;
    }
    const parsed = storableBlockSchema.safeParse(element);
    if (!parsed.success) {
      return null;
    }
    blocks.push({ block: parsed.data, section: held.section });
  }
  return blocks;
};
