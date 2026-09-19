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

export const useTreeState = (): TreeState => {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [activePath, setActivePath] = useState<string | null>(null);
  return {
    activePath,
    collapseAll: () => {
      setExpanded(new Set());
    },
    expanded,
    setActivePath,
    setExpanded,
  };
};

// every folder above a path, so a row deep in the tree is never hidden behind a folded ancestor
export const withAncestorsExpanded = (current: ReadonlySet<string>, path: string): Set<string> => {
  const next = new Set(current);
  const segments = path.split("/");
  for (let i = 1; i < segments.length; i += 1) {
    next.add(segments.slice(0, i).join("/"));
  }
  return next;
};

// the breadcrumb's reveal, applied where the fold state lives: the way to the entry opens, a
// folder opens itself, and the entry becomes the selection
export const revealInTree = (state: TreeState, path: string, isDir: boolean): void => {
  state.setExpanded((current) => {
    const next = withAncestorsExpanded(current, path);
    if (isDir) {
      next.add(path);
    }
    return next;
  });
  state.setActivePath(path);
};

// where a create from outside the tree lands: the selected folder, or the selected file's, else
// the listing's root; `isDir` answers for the active path, since the listing knows its kind
export const createDirFor = (
  rootDir: string,
  activePath: string | null,
  isDir: (path: string) => boolean,
): string => {
  if (activePath === null) {
    return rootDir;
  }
  return isDir(activePath) ? activePath : dirnamePath(activePath);
};
