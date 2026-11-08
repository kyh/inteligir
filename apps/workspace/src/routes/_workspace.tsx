// CLAUDE.md § THE OPEN ITEM RIDES THE URL, AND SETTINGS COVERS A WORKSPACE THAT STAYS MOUNTED.
// The child draws in a full-window layer here rather than in its own component, so its crash
// boundary lands in the layer too instead of below a workspace it left inert.

import { onlineManager } from "@tanstack/react-query";
import { createFileRoute, Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { libraryQueries } from "../app/cloud/library-queries";
import { Workspace } from "../app/workspace";

const workspaceSearchSchema = z.object({
  // oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
  item: z.catch(z.uuid().optional(), undefined),
});

const WorkspaceLayout = () => {
  const { item } = Route.useSearch();
  const navigate = useNavigate();
  // any child but the index draws over the workspace
  const covered = useMatch({ from: "/_workspace/", shouldThrow: false }) === undefined;
  return (
    <>
      <Workspace
        openItem={item ?? null}
        covered={covered}
        onOpenItem={(itemId) => {
          // on the current route: an open that lands while Settings covers the workspace keeps it
          void navigate({ search: (prior) => ({ ...prior, item: itemId ?? undefined }), to: "." });
        }}
      />
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
  // the rail's scopes are read before the grid draws, once, the rail asking again itself after a
  // failure; with no connection nothing is awaited, and the rail says it needs one
  loader: async ({ context }) => {
    if (!onlineManager.isOnline()) {
      return;
    }
    const { scopes } = libraryQueries(context.library.wire);
    await Promise.allSettled([
      context.queryClient.query({ ...scopes(), retry: 0, staleTime: "static" }),
    ]);
  },
  validateSearch: workspaceSearchSchema,
});
