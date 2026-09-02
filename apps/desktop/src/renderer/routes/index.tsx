import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Workspace } from "../app/workspace";

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
