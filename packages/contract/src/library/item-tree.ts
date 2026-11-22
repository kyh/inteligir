import type { z } from "zod";

import { isContainerKind } from "../items/item-kind";
import type { ItemKind } from "../items/item-kind";
import type { containerCountSchema } from "./library-wire";
import { compareText } from "./order-key";

type ContainerCount = z.infer<typeof containerCountSchema>;

export interface TreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: ItemKind;
  readonly title: string;
}

const KIND_PLACE: Readonly<Partial<Record<ItemKind, number>>> = { folder: 0, list: 1 };

export const compareTreeNodes = (a: TreeNode, b: TreeNode) =>
  (KIND_PLACE[a.kind] ?? 2) - (KIND_PLACE[b.kind] ?? 2) ||
  compareText(a.title.toLowerCase(), b.title.toLowerCase()) ||
  compareText(a.id, b.id);

export class ItemTree {
  private readonly nodes = new Map<string, TreeNode>();
  private readonly children = new Map<string | null, TreeNode[]>();

  constructor(nodes: readonly TreeNode[]) {
    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }

    for (const node of nodes) {
      const parent = this.liveParentOf(node.parentId, node.id);
      const siblings = this.children.get(parent) ?? [];
      siblings.push(node);
      this.children.set(parent, siblings);
    }

    for (const siblings of this.children.values()) {
      siblings.sort(compareTreeNodes);
    }
  }

  has(id: string) {
    return this.nodes.has(id);
  }

  liveParentOf(parentId: string | null, of?: string) {
    return parentId !== null && parentId !== of && this.nodes.has(parentId) ? parentId : null;
  }

  subtree(id: string) {
    const tree = new Set<string>();
    const pending = this.nodes.has(id) ? [id] : [];

    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (!tree.has(next)) {
        tree.add(next);
        pending.push(...(this.children.get(next) ?? []).map((child) => child.id));
      }
    }

    return tree;
  }

  containers(direct: ReadonlyMap<string, number>) {
    const counted: ContainerCount[] = [];
    const seen = new Set<string>();

    const walk = (parent: string | null) => {
      let sum = 0;

      for (const node of this.children.get(parent) ?? []) {
        if (seen.has(node.id)) {
          continue;
        }

        seen.add(node.id);
        const { id, kind, parentId, title } = node;
        const at = isContainerKind(kind) ? counted.length : null;

        if (at !== null && isContainerKind(kind)) {
          counted.push({ id, items: 0, kind, parentId: this.liveParentOf(parentId, id), title });
        }

        const items = (direct.get(id) ?? 0) + walk(id);
        const held = at === null ? undefined : counted[at];

        if (at !== null && held !== undefined) {
          counted[at] = { ...held, items };
        }

        sum += items;
      }

      return sum;
    };

    walk(null);

    return counted;
  }
}
