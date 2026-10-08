// A pathless layout, so the workspace stays mounted under Settings: a round trip keeps the
// composer, the panel and the thread it shows. The child draws in a full-window layer here rather
// than in its own component, so its crash boundary lands in the layer too instead of below a
// workspace it left inert.

import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { Workspace } from "../app/workspace";

const WorkspaceLayout = () => {
  // any child but the index draws over the workspace
  const covered = useMatch({ from: "/_workspace/", shouldThrow: false }) === undefined;
  return (
    <>
      <Workspace covered={covered} />
      {covered ? (
        <div className="fixed inset-0 bg-surface text-ink">
          <Outlet />
        </div>
      ) : null}
    </>
  );
};

export const Route = createFileRoute("/_workspace")({
  component: WorkspaceLayout,
});
