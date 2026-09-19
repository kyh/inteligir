import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Workspace } from "../app/workspace";

const workspaceSearchSchema = z.object({
  // oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
  note: z.catch(z.string().min(1).optional(), undefined),
});

const Index = () => {
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
};

export const Route = createFileRoute("/")({
  component: Index,
  validateSearch: workspaceSearchSchema,
});
