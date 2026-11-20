import { compareFolders } from "@repo/contract/library/folder-rail";
import type { ListingFolder } from "@repo/contract/library/folder-rail";

export interface FolderRow {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly label: string;
}

export const folderPaths = (folders: readonly ListingFolder[]) => {
  const children = new Map<string | null, ListingFolder[]>();
  const ids = new Set(folders.map((folder) => folder.id));

  for (const folder of folders) {
    const parent = folder.parentId !== null && ids.has(folder.parentId) ? folder.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), folder]);
  }

  const rows: FolderRow[] = [];

  const walk = (parent: string | null, depth: number, above: string) => {
    for (const folder of (children.get(parent) ?? []).toSorted(compareFolders)) {
      const label = above === "" ? folder.name : `${above} / ${folder.name}`;
      rows.push({ depth, id: folder.id, label, name: folder.name });
      walk(folder.id, depth + 1, label);
    }
  };

  walk(null, 0, "");

  return rows;
};
