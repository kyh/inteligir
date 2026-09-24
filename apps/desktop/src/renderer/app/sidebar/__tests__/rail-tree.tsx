import { useState } from "react";
import { FileTree } from "../file-tree";
import { createDirFor, useTreeState } from "../tree-state";
import type { TreeReveal } from "../tree-state";

export type RailTreeProps = Omit<React.ComponentProps<typeof FileTree>, "state"> & {
  reveal?: TreeReveal | null;
  // the rail's other views unmount the tree; a test can start on one
  startHidden?: boolean;
};

// The rail's half of the tree, so a test drives it the way the rail does: the state is owned one
// level up and follows the listing, the open note and the reveal there. Collapse all is a button
// over it; Rail new note shows the tree and starts a create where the selection says, as the
// group's New note does; Rail other view unmounts the tree, as Recent and Deleted do.
export const RailTree = ({ reveal = null, startHidden = false, ...props }: RailTreeProps) => {
  const state = useTreeState({ entries: props.entries, openPath: props.openPath, reveal });
  const [shown, setShown] = useState(!startHidden);
  const handleCollapseAll = state.collapseAll;
  const folders = new Set(
    props.entries.filter((entry) => entry.kind === "dir").map((entry) => entry.path),
  );
  const createDir = createDirFor("", state.activePath, (path) => folders.has(path));
  return (
    <>
      <button type="button" onClick={handleCollapseAll}>
        Collapse all
      </button>
      <button
        type="button"
        onClick={() => {
          setShown(true);
          state.startCreate("file", createDir);
        }}
      >
        Rail new note
      </button>
      <button
        type="button"
        onClick={() => {
          setShown(false);
        }}
      >
        Rail other view
      </button>
      <span data-create-dir={createDir} />
      {shown ? <FileTree state={state} {...props} /> : null}
    </>
  );
};
