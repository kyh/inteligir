// The library's folders as the rail and a move draw them: a parent before its children, siblings by
// their order key, then by name, each with its depth and its path of names from the top, so a
// folder two parents hold under one name reads apart.

import type { ListingFolder } from "@repo/contract/library/library-index";
import { compareText } from "@repo/contract/library/order-key";

export interface FolderRow {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  // "Reading / Papers"
  readonly label: string;
}

const bySortThenName = (a: ListingFolder, b: ListingFolder): number =>
  compareText(a.sort, b.sort) || a.name.localeCompare(b.name);

export const folderPaths = (folders: readonly ListingFolder[]): FolderRow[] => {
  const children = new Map<string | null, ListingFolder[]>();
  const ids = new Set(folders.map((folder) => folder.id));
  for (const folder of folders) {
    // a folder whose parent is not listed is shown at the top, never lost
    const parent = folder.parentId !== null && ids.has(folder.parentId) ? folder.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), folder]);
  }
  const rows: FolderRow[] = [];
  const walk = (parent: string | null, depth: number, above: string): void => {
    for (const folder of (children.get(parent) ?? []).toSorted(bySortThenName)) {
      const label = above === "" ? folder.name : `${above} / ${folder.name}`;
      rows.push({ depth, id: folder.id, label, name: folder.name });
      walk(folder.id, depth + 1, label);
    }
  };
  walk(null, 0, "");
  return rows;
};
