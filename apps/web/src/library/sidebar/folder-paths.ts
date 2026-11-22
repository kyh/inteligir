import type { ContainerKind } from "@repo/contract/items/item-kind";
import { compareTreeNodes } from "@repo/contract/library/item-tree";

export interface ContainerNode {
  readonly id: string;
  readonly kind: ContainerKind;
  readonly parentId: string | null;
  readonly title: string;
}

export interface FolderRow {
  readonly id: string;
  readonly kind: ContainerKind;
  readonly name: string;
  readonly depth: number;
  readonly label: string;
}

export const folderPaths = (containers: readonly ContainerNode[]) => {
  const children = new Map<string | null, ContainerNode[]>();
  const ids = new Set(containers.map((container) => container.id));

  for (const container of containers) {
    const parent =
      container.parentId !== null && ids.has(container.parentId) ? container.parentId : null;

    children.set(parent, [...(children.get(parent) ?? []), container]);
  }

  const rows: FolderRow[] = [];

  const walk = (parent: string | null, depth: number, above: string) => {
    for (const container of (children.get(parent) ?? []).toSorted(compareTreeNodes)) {
      const label = above === "" ? container.title : `${above} / ${container.title}`;
      rows.push({ depth, id: container.id, kind: container.kind, label, name: container.title });
      walk(container.id, depth + 1, label);
    }
  };

  walk(null, 0, "");

  return rows;
};
