// The Deleted scope: what the library's history holds and the folder no longer does, newest first,
// one card per item. A card offers Restore and never opens: the item is not there to open. A
// file deleted with the item that embedded it is not listed on its own; it comes back with that
// item (`restoreHeldFiles`).

import { docStem } from "@repo/notes/knowledge/doc-file";
import { basenamePath, dirnamePath } from "@repo/notes/knowledge/vault-path";
import { restoreAnnotationStore } from "@repo/contract/local/vault/restore-annotation-store";
import { restoreHeldFiles } from "@repo/contract/local/vault/restore-held-files";
import type { VaultDeletedEntry } from "@repo/contract/local/vault/vault-schema";
import { Button } from "@repo/ui/components/button";
import { CardGrid } from "@repo/ui/components/card-grid";
import {
  MediaCard,
  MediaCardBody,
  MediaCardCover,
  MediaCardMeta,
  MediaCardTitle,
  mediaCardHeight,
} from "@repo/ui/components/media-card";
import { toast } from "@repo/ui/components/sonner";
import { FileKindIcon } from "@repo/editor/nodes/file-card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestoreIcon } from "lucide-react";

import { client, failed, orpc, refusalMessage } from "../api";
import { relativeTimeLabel, useNow } from "../relative-time";
import { LibraryEmpty } from "./library-empty";
import type { LibraryEmptyActions } from "./library-empty";

const MIN_CELL = 180;

const restoreDoc = async (entry: VaultDeletedEntry, held: readonly VaultDeletedEntry[]) => {
  const { content } = await client.vault.revision({ path: entry.path, sha: entry.sha });
  const { path } = await client.vault.write({
    content,
    guard: { kind: "absent" },
    path: entry.path,
  });
  const annotations = await restoreAnnotationStore(client, content, entry.sha);
  const files = await restoreHeldFiles(client, held);
  return { annotations, files, path };
};

// what a restore that came back short says: its highlights, or the files it held
const restoreWarning = (
  path: string,
  annotations: Awaited<ReturnType<typeof restoreAnnotationStore>>,
  files: readonly { path: string }[],
): string | null => {
  if (annotations.kind === "failed") {
    return `Restored ${path}, but not its highlights: ${refusalMessage(annotations.error, "their store was refused")}`;
  }
  if (files.length > 0) {
    return `Restored ${path}, but not ${files.map((file) => basenamePath(file.path)).join(", ")}.`;
  }
  return null;
};

// the item a card names: a doc's stem, a file's own name
const deletedTitle = (entry: VaultDeletedEntry): string =>
  entry.kind === "doc" ? docStem(entry.path) : basenamePath(entry.path);

export const DeletedItems = ({
  emptyActions,
  onRestored,
}: {
  emptyActions: LibraryEmptyActions;
  onRestored: (path: string) => void;
}) => {
  const queryClient = useQueryClient();
  const deletedQuery = useQuery(orpc.vault.deleted.queryOptions());
  const now = useNow();
  const entries = deletedQuery.data?.entries ?? [];
  const listed = entries.filter((entry) => entry.heldBy === null);

  // the same composition as a history restore, with no bytes on disk to base it on: create
  // exclusively, so an item re-created there since is refused rather than replaced
  const restore = useMutation({
    mutationFn: async (entry: VaultDeletedEntry) => {
      if (entry.kind === "file") {
        const {
          failed: [refused],
        } = await restoreHeldFiles(client, [entry]);
        if (refused !== undefined) {
          throw new Error(
            refused.reason === "exists"
              ? `Something stands at ${entry.path} now.`
              : `Could not restore ${entry.path}.`,
          );
        }
        return { path: entry.path, warning: null };
      }
      const held = entries.filter((other) => other.heldBy === entry.path);
      const { annotations, files, path } = await restoreDoc(entry, held);
      return { path, warning: restoreWarning(path, annotations, files.failed) };
    },
    onError: (error, entry) => {
      failed(error, `Could not restore ${entry.path}.`);
    },
    onSuccess: ({ path, warning }) => {
      if (warning === null) {
        toast.success(`Restored ${basenamePath(path)}`);
      } else {
        toast.warning(warning);
      }
      void queryClient.invalidateQueries({ queryKey: orpc.vault.deleted.key() });
      onRestored(path);
    },
  });

  if (deletedQuery.isPending) {
    return <LibraryEmpty state={{ kind: "loading" }} actions={emptyActions} />;
  }
  if (deletedQuery.isLoadingError) {
    return (
      <LibraryEmpty
        state={{ kind: "failed" }}
        actions={{
          ...emptyActions,
          retry: () => {
            void deletedQuery.refetch();
          },
        }}
      />
    );
  }
  if (listed.length === 0) {
    return (
      <div aria-live="polite" className="flex flex-1 items-center justify-center p-8">
        <p className="m-0 text-title font-medium text-ink">Nothing deleted.</p>
      </div>
    );
  }
  return (
    <CardGrid
      aria-label="Deleted items"
      count={listed.length}
      minCellWidth={MIN_CELL}
      cellHeight={(width) => mediaCardHeight(width) + 32}
      renderCell={(index) => {
        const entry = listed[index];
        if (entry === undefined) {
          return null;
        }
        const at = Date.parse(entry.deletedAt);
        const folder = dirnamePath(entry.path);
        const meta = [
          Number.isNaN(at) ? null : `Deleted ${relativeTimeLabel(at, now, { inSentence: true })}`,
          folder === "" ? null : folder,
        ]
          .filter((part) => part !== null)
          .join(" · ");
        return (
          <MediaCard data-deleted-path={entry.path} aria-label={deletedTitle(entry)}>
            <MediaCardCover className="flex items-center justify-center">
              <FileKindIcon
                path={entry.path}
                aria-hidden
                className="size-9 text-muted-foreground"
                strokeWidth={1.25}
              />
            </MediaCardCover>
            <MediaCardBody>
              <MediaCardTitle>{deletedTitle(entry)}</MediaCardTitle>
              <MediaCardMeta>{meta}</MediaCardMeta>
              <div className="mt-auto">
                <Button
                  variant="secondary"
                  size="compact"
                  leadingIcon={ArchiveRestoreIcon}
                  disabled={restore.isPending}
                  onClick={() => {
                    restore.mutate(entry);
                  }}
                >
                  Restore
                </Button>
              </div>
            </MediaCardBody>
          </MediaCard>
        );
      }}
    />
  );
};
