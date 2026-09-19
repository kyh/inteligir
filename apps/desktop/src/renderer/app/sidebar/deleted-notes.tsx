import { docStem } from "@repo/notes/knowledge/doc-file";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import { restoreCommentStore } from "@repo/api/local/vault/restore-comment-store";
import type { VaultDeletedEntry } from "@repo/api/local/vault/vault-schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@repo/ui/components/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@repo/ui/components/sidebar";
import { toast } from "@repo/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc, refusalMessage } from "../api";
import { relativeTimeLabel } from "../relative-time";
import { useWorkspace } from "../workspace-context";

// The rail's third view: what the vault's history holds and the tree no longer does, one row per
// deleted note, newest first. A click restores it where it was and opens it; the right-click
// names the verb. Mounted only while the view shows, so the log is read only then.
export const DeletedNotes = ({ onOpenNote }: { onOpenNote: (path: string) => void }) => {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const deletedQuery = useQuery(orpc.vault.deleted.queryOptions());
  const [menu, setMenu] = useState<{ entry: VaultDeletedEntry; anchor: HTMLElement } | null>(null);

  // The same composition as a history restore, with no bytes on disk to base it on:
  // create-exclusively, so a note re-created there since is refused rather than replaced.
  const restore = useMutation({
    mutationFn: async (entry: VaultDeletedEntry) => {
      const { content } = await api.vault.revision({ path: entry.path, sha: entry.sha });
      const restored = await api.vault.write({ content, ifAbsent: true, path: entry.path });
      await restoreCommentStore(api, content, entry.sha);
      return restored;
    },
    onError: (error, entry) => {
      toast.error(refusalMessage(error, `Could not restore ${entry.path}.`));
    },
    onSuccess: (restored) => {
      void queryClient.invalidateQueries({ queryKey: orpc.vault.deleted.key() });
      onOpenNote(restored.path);
    },
  });

  const entries = deletedQuery.data?.entries ?? [];
  // Not Date.now(): a clock read in render is impure, and the query refetches on every mount.
  const now = deletedQuery.dataUpdatedAt;

  if (deletedQuery.isPending) {
    return <p className="px-2 py-2 text-body text-muted-foreground">Loading…</p>;
  }
  if (entries.length === 0) {
    return <p className="px-2 py-2 text-body text-muted-foreground">Nothing has been deleted.</p>;
  }

  return (
    <>
      <SidebarMenu aria-label="Deleted notes">
        {entries.map((entry) => {
          const at = Date.parse(entry.deletedAt);
          const hint = dirnamePath(entry.path);
          return (
            <SidebarMenuItem key={entry.path}>
              <SidebarMenuButton
                title={entry.path}
                disabled={restore.isPending}
                onClick={() => {
                  restore.mutate(entry);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ anchor: event.currentTarget, entry });
                }}
              >
                {docStem(entry.path)}
                {hint === "" ? null : (
                  <span className="min-w-0 truncate text-caption text-muted-foreground">
                    {hint}
                  </span>
                )}
                {Number.isNaN(at) ? null : (
                  <span className="ml-auto shrink-0 text-caption text-muted-foreground">
                    {relativeTimeLabel(at, now)}
                  </span>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
      <DropdownMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null);
          }
        }}
      >
        {menu === null ? null : (
          <DropdownMenuContent anchor={menu.anchor} align="start" side="bottom">
            <DropdownMenuItem
              onClick={() => {
                const { entry } = menu;
                setMenu(null);
                restore.mutate(entry);
              }}
            >
              Restore
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    </>
  );
};
