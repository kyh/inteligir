// The workspace IS the index route: this app is the local product on a
// local origin — there is no marketing surface here to share "/" with, so an
// /app indirection would only be a redirect nobody needed. The open note
// rides the `note` search param (deep-linkable, back/forward works).

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Workspace } from "../app/workspace";
import { WorkspaceProvider } from "../app/workspace-context";

interface WorkspaceSearch {
  note?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => {
    const note = search["note"];
    return typeof note === "string" && note !== "" ? { note } : {};
  },
  component: Index,
});

function Index() {
  const { note } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <WorkspaceProvider>
      <Workspace
        openNote={note ?? null}
        onOpenNote={(path) => {
          void navigate({ to: "/", search: path === null ? {} : { note: path } });
        }}
      />
    </WorkspaceProvider>
  );
}
