// The live folders as the rail draws them, which the library's listing files its items by
// (`./library-index`) and the server rolls its counts up through
// (`@repo/service/library/library-listing`).

import type { z } from "zod";

import type { folderCountSchema } from "./library-wire";
import { compareText } from "./order-key";

type FolderCount = z.infer<typeof folderCountSchema>;

export interface ListingFolder {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  // its order key among its siblings
  readonly sort: string;
}

// each live folder under its parent, a parent before its children and siblings by their order key,
// then name; one whose parent is not live stands at the top. An item in a folder not here reads as
// unsorted
export class FolderRail {
  private readonly live: ReadonlySet<string>;
  private readonly children = new Map<string | null, ListingFolder[]>();

  constructor(folders: readonly ListingFolder[]) {
    this.live = new Set(folders.map((folder) => folder.id));
    for (const folder of folders) {
      const parent =
        folder.parentId !== null && this.live.has(folder.parentId) ? folder.parentId : null;
      const siblings = this.children.get(parent) ?? [];
      siblings.push(folder);
      this.children.set(parent, siblings);
    }
    for (const siblings of this.children.values()) {
      siblings.sort(
        (a, b) =>
          compareText(a.sort, b.sort) || compareText(a.name, b.name) || compareText(a.id, b.id),
      );
    }
  }

  has(folderId: string): boolean {
    return this.live.has(folderId);
  }

  // a live folder and every folder under it; none for a folder not live
  tree(folderId: string): ReadonlySet<string> {
    const tree = new Set<string>();
    const pending = this.live.has(folderId) ? [folderId] : [];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      tree.add(next);
      pending.push(...(this.children.get(next) ?? []).map((child) => child.id));
    }
    return tree;
  }

  // every folder in rail order, counting the items filed in it (`direct`) and in every folder
  // under it
  counted(direct: ReadonlyMap<string, number>): FolderCount[] {
    const folders: FolderCount[] = [];
    const walk = (parent: string | null): number => {
      let sum = 0;
      for (const { id, name, parentId, sort } of this.children.get(parent) ?? []) {
        const at = folders.length;
        folders.push({ id, items: 0, name, parentId, sort });
        const items = (direct.get(id) ?? 0) + walk(id);
        folders[at] = { id, items, name, parentId, sort };
        sum += items;
      }
      return sum;
    };
    walk(null);
    return folders;
  }
}
