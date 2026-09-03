import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { docStem } from "@repo/notes/knowledge/doc-file";
import type { VaultDeletedEntry } from "@repo/api/local/vault/vault-schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@repo/ui/components/sonner";
import { orpc, refusalMessage } from "../api";
import { relativeTimeLabel } from "../relative-time";
import { useWorkspace } from "../workspace-context";

export interface DeletedNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenNote: (path: string) => void;
}

export function DeletedNotesDialog({ open, onOpenChange, onOpenNote }: DeletedNotesDialogProps) {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const deletedQuery = useQuery({ ...orpc.vault.deleted.queryOptions(), enabled: open });

  // The same composition as a history restore, with no bytes on disk to base
  // it on: create-exclusively, so a note re-created there since is refused
  // rather than replaced.
  const restore = useMutation({
    mutationFn: async (entry: VaultDeletedEntry) => {
      const { content } = await api.vault.revision({ path: entry.path, sha: entry.sha });
      return api.vault.write({ path: entry.path, content, ifAbsent: true });
    },
    onError: (error, entry) => {
      toast.error(refusalMessage(error, `Could not restore ${entry.path}.`));
    },
    onSuccess: (restored) => {
      void queryClient.invalidateQueries({ queryKey: orpc.vault.deleted.key() });
      onOpenChange(false);
      onOpenNote(restored.path);
    },
  });

  const entries = deletedQuery.data?.entries ?? [];
  // Not Date.now(): a clock read in render is impure, and the query refetches
  // on every open anyway.
  const now = deletedQuery.dataUpdatedAt;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Deleted notes</DialogTitle>
          <DialogDescription>
            A deleted note stays in the vault's history. Restore one to bring it back where it was.
          </DialogDescription>
        </DialogHeader>
        <div className="-mr-2 max-h-[60dvh] space-y-1 overflow-y-auto pr-2">
          {deletedQuery.isPending && open ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">Nothing has been deleted.</p>
          ) : (
            entries.map((entry) => {
              const at = Date.parse(entry.deletedAt);
              return (
                <div
                  key={entry.path}
                  className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{docStem(entry.path)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.path}
                      {Number.isNaN(at) ? null : ` · ${relativeTimeLabel(at, now)}`}
                    </p>
                  </div>
                  <Button
                    variant="tertiary"
                    size="compact"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(entry)}
                  >
                    Restore
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
