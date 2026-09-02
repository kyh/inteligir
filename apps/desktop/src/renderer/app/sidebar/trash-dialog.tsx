import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@repo/ui/components/sonner";
import { orpc, refusalMessage } from "../api";
import { relativeTimeLabel } from "../relative-time";
import { useWorkspace } from "../workspace-context";

export interface TrashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenNote: (path: string) => void;
}

export function TrashDialog({ open, onOpenChange, onOpenNote }: TrashDialogProps) {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const trashQuery = useQuery({ ...orpc.vault.trashList.queryOptions(), enabled: open });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: orpc.vault.trashList.key() });
  };

  const restore = useMutation({
    mutationFn: async (path: string) => api.vault.trashRestore({ path }),
    onError: (error, path) => {
      toast.error(refusalMessage(error, `Could not restore ${path}.`));
    },
    onSuccess: (restored) => {
      invalidate();
      onOpenChange(false);
      onOpenNote(restored.path);
    },
  });

  const purge = useMutation({
    mutationFn: async (path: string) => api.vault.trashPurge({ path }),
    onError: (error, path) => {
      toast.error(refusalMessage(error, `Could not delete ${path}.`));
    },
    onSuccess: invalidate,
  });

  const entries = trashQuery.data?.entries ?? [];
  // Not Date.now(): a clock read in render is impure, and the query refetches
  // on every open anyway.
  const now = trashQuery.dataUpdatedAt;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Trash</DialogTitle>
          <DialogDescription>
            Deleted notes are kept for 30 days, then removed for good.
          </DialogDescription>
        </DialogHeader>
        <div className="-mr-2 max-h-[60dvh] space-y-1 overflow-y-auto pr-2">
          {trashQuery.isPending && open ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">The trash is empty.</p>
          ) : (
            entries.map((entry) => {
              const at = entry.trashedAt === null ? null : Date.parse(entry.trashedAt);
              return (
                <div
                  key={entry.path}
                  className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{docStem(entry.path)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.trashedFrom ?? entry.path.replace(/^Trash\//, "")}
                      {at !== null && !Number.isNaN(at) ? ` · ${relativeTimeLabel(at, now)}` : null}
                    </p>
                  </div>
                  <Button
                    variant="tertiary"
                    size="compact"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(entry.path)}
                  >
                    Restore
                  </Button>
                  <Button
                    variant="ghost"
                    size="compact"
                    className="text-destructive"
                    disabled={purge.isPending}
                    onClick={() => purge.mutate(entry.path)}
                  >
                    Delete forever
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
