// Where the app window opens after a first run: the steps between the vault it chose and its notes,
// drawn over the workspace like Settings, so the vault is already loading underneath. The workspace
// boots on Welcome.md when the vault has one (its boot prefers it), so finishing uncovers that note
// and keeps the `?note=` its open mirrored here.

import { Button } from "@repo/ui/components/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

const Welcome = () => {
  const navigate = useNavigate();
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-title font-medium">Your vault is ready</h1>
        <p className="text-body text-muted-foreground">
          Everything you write is saved in it as you go, as plain files on your Mac.
        </p>
        <Button
          className="mt-2"
          onClick={() => {
            void navigate({ search: true, to: "/" });
          }}
        >
          Open my notes
        </Button>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_workspace/welcome")({
  component: Welcome,
});
