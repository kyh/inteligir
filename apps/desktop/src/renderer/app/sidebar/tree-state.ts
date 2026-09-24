// The tree's fold, focus and edit state, owned by the rail: collapse-all is a plain set, and where
// a create from the header lands (the selected folder, else the selected file's) is derived here
// rather than reported back up by an effect. What the state follows — the listing, the open note
// and the breadcrumb's reveal — is applied during the owner's own render, because the tree
// setting its owner's state while it renders is a React error; the tree only reads it.

import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import { useState } from "react";

// the one name input the tree draws: over a row it renames, or under the folder it creates in
export type TreeEditing =
  | { mode: "rename"; path: string }
  | { mode: "create"; kind: VaultEntry["kind"]; parentDir: string };

// the breadcrumb's ask, keyed by the nonce so naming the same entry twice reveals it twice
export interface TreeReveal {
  path: string;
  nonce: number;
}

interface TreeFollows {
  entries: readonly VaultEntry[];
  openPath: string | null;
  reveal: TreeReveal | null;
  // the owner clears its reveal once the tree has focused it, or a rail mounted again (a toggle,
  // zen, a peek) would replay it and take the focus back into the tree
  onRevealConsumed: () => void;
}

export interface TreeState {
  expanded: ReadonlySet<string>;
  setExpanded: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  activePath: string | null;
  setActivePath: React.Dispatch<React.SetStateAction<string | null>>;
  collapseAll: () => void;
  editing: TreeEditing | null;
  // "" is the vault root; the folder and every one above it open in the same update, so the input
  // is in the first paint
  startCreate: (kind: VaultEntry["kind"], parentDir: string) => void;
  // where a create from outside the tree lands, as an IDE's would: in the selected folder, or the
  // selected file's, else at the vault root
  startCreateInSelection: (kind: VaultEntry["kind"]) => void;
  startRename: (path: string) => void;
  stopEditing: () => void;
  // a reveal applied to the fold whose row the tree has not focused yet: the tree focuses it once
  // and says so, so a tree mounted later (a view switch, a create) never replays it
  revealToFocus: string | null;
  revealFocused: () => void;
}

// every folder above a path, so a row deep in the tree is never hidden behind a folded ancestor
export const withAncestorsExpanded = (current: ReadonlySet<string>, path: string): Set<string> => {
  const next = new Set(current);
  const segments = path.split("/");
  for (let i = 1; i < segments.length; i += 1) {
    next.add(segments.slice(0, i).join("/"));
  }
  return next;
};

export const useTreeState = ({
  entries,
  openPath,
  reveal,
  onRevealConsumed,
}: TreeFollows): TreeState => {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [activePath, setActivePath] = useState<string | null>(null);
  const [editing, setEditing] = useState<TreeEditing | null>(null);
  const [revealToFocus, setRevealToFocus] = useState<string | null>(null);

  // Keyed on the listing's paths alone: a listing that only restamps a note's modifiedMs is the
  // same tree, and reconciling on it, or on every activePath change, would clear an optimistic
  // rename-follow before the refetched listing confirms it. An updater, so a reveal applied in the
  // same render keeps the selection it sets.
  const pathKey = entries.map((entry) => entry.path).join("\0");
  const [reconciledKey, setReconciledKey] = useState(pathKey);
  if (reconciledKey !== pathKey) {
    setReconciledKey(pathKey);
    setActivePath((current) =>
      current !== null && !entries.some((entry) => entry.path === current) ? null : current,
    );
  }

  // The way to the entry opens, a folder opens itself, and the entry becomes the selection.
  const [appliedReveal, setAppliedReveal] = useState<number | null>(null);
  if (reveal !== null && reveal.nonce !== appliedReveal) {
    setAppliedReveal(reveal.nonce);
    const isDir = entries.some((entry) => entry.kind === "dir" && entry.path === reveal.path);
    setExpanded((current) => {
      const next = withAncestorsExpanded(current, reveal.path);
      if (isDir) {
        next.add(reveal.path);
      }
      return next;
    });
    setActivePath(reveal.path);
    setRevealToFocus(reveal.path);
  }

  // Seeded null so a rail mounting on an already-open note expands to it.
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  if (expandedFor !== openPath) {
    setExpandedFor(openPath);
    if (openPath !== null && openPath.includes("/")) {
      setExpanded((current) => withAncestorsExpanded(current, openPath));
    }
  }

  const startCreate: TreeState["startCreate"] = (kind, parentDir) => {
    if (parentDir !== "") {
      setExpanded((current) => withAncestorsExpanded(current, parentDir).add(parentDir));
    }
    setEditing({ kind, mode: "create", parentDir });
  };

  return {
    activePath,
    collapseAll: () => {
      setExpanded(new Set());
    },
    editing,
    expanded,
    revealFocused: () => {
      setRevealToFocus(null);
      onRevealConsumed();
    },
    revealToFocus,
    setActivePath,
    setExpanded,
    startCreate,
    startCreateInSelection: (kind) => {
      if (activePath === null) {
        startCreate(kind, "");
        return;
      }
      const isDir = entries.some((entry) => entry.kind === "dir" && entry.path === activePath);
      startCreate(kind, isDir ? activePath : dirnamePath(activePath));
    },
    startRename: (path) => {
      setEditing({ mode: "rename", path });
    },
    stopEditing: () => {
      setEditing(null);
    },
  };
};
