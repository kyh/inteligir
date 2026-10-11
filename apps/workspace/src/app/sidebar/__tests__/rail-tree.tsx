import { useState } from "react";
import { FileTree } from "../file-tree";
import { useTreeState } from "../tree-state";
import type { TreeReveal } from "../tree-state";

export type RailTreeProps = Omit<React.ComponentProps<typeof FileTree>, "state"> & {
  // the reveal the owner starts with; the owner clears it once the tree says it is consumed
  reveal?: TreeReveal | null;
  // the rail's other views unmount the tree; a test can start on one
  startHidden?: boolean;
};

type RailContentProps = Omit<RailTreeProps, "reveal"> & {
  reveal: TreeReveal | null;
  onRevealConsumed: () => void;
};

// The rail's half of the tree: the state is owned here and follows the listing, the open note
// and the reveal. Collapse all is a button over it; Rail new note shows the tree and starts a
// create where the selection says, as the group's New note does; Rail other view unmounts the
// tree, as Recent and Deleted do.
const RailContent = ({
  reveal,
  onRevealConsumed,
  startHidden = false,
  ...props
}: RailContentProps) => {
  const state = useTreeState({
    entries: props.entries,
    onRevealConsumed,
    openPath: props.openPath,
    reveal,
  });
  const [shown, setShown] = useState(!startHidden);
  const handleCollapseAll = state.collapseAll;
  return (
    <>
      <button type="button" onClick={handleCollapseAll}>
        Collapse all
      </button>
      <button
        type="button"
        onClick={() => {
          setShown(true);
          state.startCreateInSelection("file");
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
      {shown ? <FileTree state={state} {...props} /> : null}
    </>
  );
};

// The workspace's half, so a test drives the tree the way the window does: the reveal is the
// owner's state, and Rail toggle unmounts the whole rail content, as collapsing the rail, zen and
// a peek do.
export const RailTree = ({ reveal: initialReveal = null, ...props }: RailTreeProps) => {
  const [reveal, setReveal] = useState(initialReveal);
  const [railShown, setRailShown] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRailShown((shown) => !shown);
        }}
      >
        Rail toggle
      </button>
      {railShown ? (
        <RailContent
          reveal={reveal}
          onRevealConsumed={() => {
            setReveal(null);
          }}
          {...props}
        />
      ) : null}
    </>
  );
};
