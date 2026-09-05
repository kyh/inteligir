// The tree's fold and focus state, owned by the rail: collapse-all is a plain set, and where a
// create from the header lands (the selected folder, else the selected file's) is derived here
// rather than reported back up by an effect.

import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import { useState } from "react";

export interface TreeState {
  expanded: ReadonlySet<string>;
  setExpanded: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  activePath: string | null;
  setActivePath: React.Dispatch<React.SetStateAction<string | null>>;
  collapseAll: () => void;
}

export function useTreeState(): TreeState {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [activePath, setActivePath] = useState<string | null>(null);
  return {
    expanded,
    setExpanded,
    activePath,
    setActivePath,
    collapseAll: () => {
      setExpanded(new Set());
    },
  };
}

// where a create from outside the tree lands: the selected folder, or the selected file's, else
// the listing's root; `isDir` answers for the active path, since the listing knows its kind
export function createDirFor(
  rootDir: string,
  activePath: string | null,
  isDir: (path: string) => boolean,
): string {
  if (activePath === null) return rootDir;
  return isDir(activePath) ? activePath : dirnamePath(activePath);
}
