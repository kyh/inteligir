// A pill as a node of the editor's value: its own fields decoded once, every pill of a note in
// reading order, and what each of them shows.

import { ElementApi } from "platejs";
import type { Descendant, Path, TElement, TNode } from "platejs";

import { FORMULA_PILL_KEY } from "@repo/editor/dialect-node-keys";
import { displaysOf } from "@repo/editor/formulas/displays";
import type { Pill } from "@repo/editor/formulas/displays";
import { stringProp } from "@repo/editor/node-props";

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

// `blocks` with each pill showing what its source gives among them alone: a whole body read from
// markdown, or blocks moved into a note of their own, which no editor's normalizer has seen
export const settledAlone = (blocks: readonly TElement[]): readonly TElement[] => {
  const displays = new Map(unsettledPills(blocks).map(({ node, display }) => [node, display]));
  const settled = (node: TElement): TElement => {
    const display = displays.get(node);
    return display === undefined
      ? {
          ...node,
          children: node.children.map((child) =>
            ElementApi.isElement(child) ? settled(child) : child,
          ),
        }
      : { ...node, display };
  };
  return displays.size === 0 ? blocks : blocks.map(settled);
};
