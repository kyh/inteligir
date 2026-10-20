// CLAUDE.md § THE NOTE STORE OWNS THE OPEN ITEM. The child draws in a full-window layer here
// rather than in its own component, so its crash boundary lands in the layer too instead of below
// a workspace it left inert.

import { createFileRoute, Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useAgentsStatus } from "../app/agents/agent-hooks";
import { Workspace } from "../app/workspace";

const workspaceSearchSchema = z.object({
  // oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
  item: z.catch(z.string().min(1).optional(), undefined),
});

const WorkspaceLayout = () => {
  const { item } = Route.useSearch();
  const navigate = useNavigate();
  // any child but the index draws over the workspace
  const covered = useMatch({ from: "/_workspace/", shouldThrow: false }) === undefined;
  // ⌘K draws nothing until the vendors have answered, and a cold probe takes seconds: observed
  // here, their answer stays cached past gcTime, so the composer draws its field at once.
  useAgentsStatus();
  return (
    <>
      <Workspace
        bootItem={item ?? null}
        covered={covered}
        onOpenItem={(path) => {
          // replace, and on the current route: the note store keeps the one back/forward history,
          // where the library is a step with no param, and an item that moves while Settings
          // shows must not take Settings down, nor a boot that lands under /welcome drop its step
          void navigate({
            replace: true,
            search: (prior) => ({ ...prior, item: path ?? undefined }),
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
