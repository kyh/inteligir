import { FileTree } from "../file-tree";
import { createDirFor, useTreeState } from "../tree-state";

export type RailTreeProps = Omit<React.ComponentProps<typeof FileTree>, "state">;

// The rail's half of the tree, so a test drives it the way the rail does: the state is
// owned one level up, Collapse all is a button over it and the create dir is derived from it.
export function RailTree(props: RailTreeProps) {
  const state = useTreeState();
  const folders = new Set(
    props.entries.filter((entry) => entry.kind === "dir").map((entry) => entry.path),
  );
  return (
    <>
      <button type="button" onClick={state.collapseAll}>
        Collapse all
      </button>
      <span
        data-create-dir={createDirFor(props.rootDir, state.activePath, (path) => folders.has(path))}
      />
      <FileTree state={state} {...props} />
    </>
  );
}
