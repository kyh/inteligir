// Derive an Obsidian-style nested folder tree from the vault's flat file
// listing. The vault stores paths like "projects/q3/plan.md"; the sidebar wants
// folders that expand. Pure + deterministic so it can be unit-tested and so the
// sidebar re-renders identically for the same listing.

import type { VaultEntry } from "@repo/core/ipc-registry";

export type VaultTreeNode =
  | { type: "folder"; name: string; path: string; children: VaultTreeNode[] }
  | { type: "file"; name: string; path: string; kind: VaultEntry["kind"] };

type FolderBuilder = {
  folders: Map<string, FolderBuilder>;
  files: VaultEntry[];
};

function emptyFolder(): FolderBuilder {
  return { folders: new Map(), files: [] };
}

/** Build a nested tree from flat vault entries. Folders sort before files;
 * both sort case-insensitively by name. Empty folders never appear because the
 * listing only carries files — a folder exists exactly when it holds a file. */
export function buildVaultTree(entries: VaultEntry[]): VaultTreeNode[] {
  const root = emptyFolder();

  for (const entry of entries) {
    const segments = entry.path.split("/");
    let cursor = root;
    // Walk/realize each directory segment, leaving the final segment as a file.
    for (let i = 0; i < segments.length - 1; i++) {
      const dir = segments[i];
      if (dir === undefined || dir === "") continue;
      let next = cursor.folders.get(dir);
      if (!next) {
        next = emptyFolder();
        cursor.folders.set(dir, next);
      }
      cursor = next;
    }
    cursor.files.push(entry);
  }

  return materialize(root, "");
}

function materialize(builder: FolderBuilder, prefix: string): VaultTreeNode[] {
  const folderNodes: VaultTreeNode[] = [...builder.folders.entries()]
    .map(([name, child]): VaultTreeNode => {
      const path = prefix ? `${prefix}/${name}` : name;
      return { type: "folder", name, path, children: materialize(child, path) };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const fileNodes: VaultTreeNode[] = builder.files
    .map((entry): VaultTreeNode => {
      const name = entry.path.split("/").pop() ?? entry.name;
      return { type: "file", name, path: entry.path, kind: entry.kind };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return [...folderNodes, ...fileNodes];
}
