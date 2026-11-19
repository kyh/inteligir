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

export const pillOf = (node: TElement) =>
  ({
    name: stringProp(node, "name"),
    source: stringProp(node, "source") ?? "",
  }) satisfies Pill;

export interface PillEntry {
  readonly node: TElement;
  readonly at: Path;
}

export const pillEntries: (nodes: readonly Descendant[], above?: Path) => PillEntry[] = (
  nodes: readonly Descendant[],
  above: Path = [],
) =>
  nodes.flatMap((node, index) => {
    if (!ElementApi.isElement(node)) {
      return [] satisfies PillEntry[];
    }

    const at = [...above, index];

    return (
      node.type === FORMULA_PILL_KEY ? [{ at, node }] : pillEntries(node.children, at)
    ) satisfies PillEntry[];
  });

export const unsettledPills = (nodes: readonly Descendant[]) => {
  const entries = pillEntries(nodes);
  const displays = displaysOf(entries.map(({ node }) => pillOf(node)));

  return entries.flatMap((entry, index) => {
    const display = displays[index];

    return display === undefined || display === stringProp(entry.node, "display")
      ? []
      : [{ ...entry, display }];
  });
};

const withDisplays: (node: TElement, displays: ReadonlyMap<TElement, string>) => TElement = (
  node: TElement,
  displays: ReadonlyMap<TElement, string>,
) => {
  const display = displays.get(node);

  return (
    display === undefined
      ? {
          ...node,
          children: node.children.map((child) =>
            ElementApi.isElement(child) ? withDisplays(child, displays) : child,
          ),
        }
      : { ...node, display }
  ) satisfies TElement;
};

const settledByIndex = (blocks: readonly TElement[]) => {
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

export const settledAlone = (blocks: readonly TElement[]) => {
  const settled = settledByIndex(blocks);

  return settled.size === 0 ? blocks : blocks.map((block, index) => settled.get(index) ?? block);
};

export const settledBody = (body: readonly BodyBlock[]) => {
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
