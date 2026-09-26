// A pathless layout, so the workspace stays mounted under Settings: a round trip keeps the open
// note, its undo history, the composer and zen, and never re-walks the vault. The child draws in
// a full-window layer here rather than in its own component, so its crash boundary lands in the
// layer too instead of below a workspace it left inert.

import { createFileRoute, Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Workspace } from "../app/workspace";

const workspaceSearchSchema = z.object({
  // oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
  note: z.catch(z.string().min(1).optional(), undefined),
});

const WorkspaceLayout = () => {
  const { note } = Route.useSearch();
  const navigate = useNavigate();
  // any child but the index draws over the workspace
  const covered = useMatch({ from: "/_workspace/", shouldThrow: false }) === undefined;
  return (
    <>
      <Workspace
        bootNote={note ?? null}
        covered={covered}
        onOpenNote={(path) => {
          // replace, and on the current route: the note store keeps the one back/forward history,
          // and a note that moves while Settings shows must not take Settings down, nor a boot
          // that lands under /welcome drop the step it is on
          void navigate({
            replace: true,
            search: (prior) => ({ ...prior, note: path ?? undefined }),
            to: ".",
          });
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
  validateSearch: workspaceSearchSchema,
});
