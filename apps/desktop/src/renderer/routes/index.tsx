// The workspace IS the index route: this app is the local product on a
// local origin — there is no marketing surface here to share "/" with, so an
// /app indirection would only be a redirect nobody needed. The open note
// rides the `note` search param (deep-linkable, back/forward works).

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Workspace } from "../app/workspace";

/** An empty or non-string `note` is the same as none: the workspace opens
 *  what it was last on rather than an unnamed document. */
const workspaceSearchSchema = z.object({
  note: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/")({
  validateSearch: workspaceSearchSchema,
  component: Index,
});

function Index() {
  const { note } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <Workspace
      openNote={note ?? null}
      onOpenNote={(path) => {
        void navigate({ to: "/", search: path === null ? {} : { note: path } });
      }}
    />
  );
}
