import type { ListingFolder } from "@repo/contract/library/folder-rail";
import { compareText } from "@repo/contract/library/order-key";

export interface FolderRow {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly label: string;
}

const bySortThenName = (a: ListingFolder, b: ListingFolder) =>
  compareText(a.sort, b.sort) || a.name.localeCompare(b.name);

export const folderPaths = (folders: readonly ListingFolder[]) => {
  const children = new Map<string | null, ListingFolder[]>();
  const ids = new Set(folders.map((folder) => folder.id));

  for (const folder of folders) {
    const parent = folder.parentId !== null && ids.has(folder.parentId) ? folder.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), folder]);
  }

  const rows: FolderRow[] = [];

  const walk = (parent: string | null, depth: number, above: string) => {
    for (const folder of (children.get(parent) ?? []).toSorted(bySortThenName)) {
      const label = above === "" ? folder.name : `${above} / ${folder.name}`;
      rows.push({ depth, id: folder.id, label, name: folder.name });
      walk(folder.id, depth + 1, label);
    }
  };

  walk(null, 0, "");

  return rows;
};
