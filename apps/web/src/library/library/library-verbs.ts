import type { InferClientInputs } from "@orpc/client";
import { BULK_ITEMS_MAX } from "@repo/contract/library/library-wire";
import type { SavedView } from "@repo/contract/library/saved-views";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useLibraryWrites, usePageLibrary } from "../cloud/library-context";
import type { SaveInto } from "../cloud/library-writes";
import { runBulk } from "./bulk-actions";
import type { BulkRun } from "./bulk-actions";
import type { CapturedLink } from "./capture/capture-payload";
import type { Target } from "./library-selection";
import { newId } from "../cloud/new-id";

export interface TagChange {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

type SweepVerb = InferClientInputs<V1Client>["library"]["items"]["sweep"]["verb"];

export const useLibraryVerbs = () => {
  const { orpc } = usePageLibrary().wire;
  const writes = useLibraryWrites();
  const queryClient = useQueryClient();
  const organize = useMutation(writes.organize());
  const remove = useMutation(writes.remove());
  const restore = useMutation(writes.restore());
  const purge = useMutation(writes.purge());
  const sweep = useMutation(writes.sweep());
  const writeContainers = useMutation(writes.containers());
  const refresh = useMutation(writes.refresh());
  const createNote = useMutation(writes.createNote());
  const saveLink = useMutation(writes.saveLink());
  const addFile = useMutation(writes.addFile());

  const readScopesAgain = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.library.listing.scopes.key() });
  };

  const saveView = useMutation(
    orpc.library.views.save.mutationOptions({
      onError: (error) => {
        toast.error(refusalText(error, "The view couldn't be saved."));
      },
      onSettled: readScopesAgain,
    }),
  );

  const removeView = useMutation(
    orpc.library.views.remove.mutationOptions({
      onError: (error) => {
        toast.error(refusalText(error, "The view couldn't be deleted."));
      },
      onSettled: readScopesAgain,
    }),
  );

  const containers = () =>
    queryClient.getQueryData(orpc.library.listing.scopes.queryKey())?.containers ?? [];

  const bulk = async (
    target: Target,
    job: Omit<BulkRun<string>, "chunk" | "items"> & { readonly sweep: SweepVerb },
  ) => {
    if (target.kind === "ids") {
      await runBulk({ ...job, chunk: BULK_ITEMS_MAX, items: target.ids });

      return 0;
    }

    try {
      const { items, refused } = await sweep.mutateAsync({ ...target.swept, verb: job.sweep });
      toast.success(job.done(items - refused.length));

      return refused.length;
    } catch (error) {
      toast.error(refusalText(error, `Those items couldn't be ${job.past}.`));

      return 0;
    }
  };

  const restoreItems = async (target: Target) => {
    let held = 0;

    const sweptHeld = await bulk(target, {
      done: (count) => `Restored ${plural(count, "item")}.`,
      past: "restored",
      run: async (chunk) => {
        const { addressHeld, restored } = await restore.mutateAsync({ ids: [...chunk] });
        held += addressHeld.length;

        return restored.length;
      },
      sweep: { kind: "restore" },
      verb: "Restoring",
    });

    held += sweptHeld;

    if (held > 0) {
      toast.info(`${plural(held, "item")} stayed in Deleted: another item holds the same address.`);
    }
  };

  return {
    addFiles: async (files: readonly File[], into: SaveInto) => {
      await runBulk({
        chunk: 1,
        done: (count) => `Added ${plural(count, "file")}.`,
        items: files,
        noun: "file",
        past: "added",
        run: async (chunk) => {
          for (const file of chunk) {
            await addFile.mutateAsync({ file, into });
          }

          return chunk.length;
        },
        show: "always",
        verb: "Adding",
      });
    },
    createNote: async (into: SaveInto) => await createNote.mutateAsync({ into }),
    move: async (target: Target, parentId: string | null) => {
      const parent = parentId === null ? null : { id: parentId };
      await bulk(target, {
        done: (count) => `Moved ${plural(count, "item")}.`,
        past: "moved",
        run: async (chunk) => {
          const { items } = await organize.mutateAsync({ ids: [...chunk], parent });

          return items.length;
        },
        sweep: { kind: "organize", parent },
        verb: "Moving",
      });
    },
    pin: async (target: Target, pinned: boolean) => {
      await bulk(target, {
        done: (count) => `${pinned ? "Pinned" : "Unpinned"} ${plural(count, "item")}.`,
        past: pinned ? "pinned" : "unpinned",
        run: async (chunk) => {
          const { items } = await organize.mutateAsync({ ids: [...chunk], pinned });

          return items.length;
        },
        sweep: { kind: "organize", pinned },
        verb: pinned ? "Pinning" : "Unpinning",
      });
    },
    purge: async (target: Target) => {
      await bulk(target, {
        done: (count) => `Deleted ${plural(count, "item")} forever.`,
        past: "deleted",
        run: async (chunk) => {
          const { purged } = await purge.mutateAsync({ ids: [...chunk] });

          return purged.length;
        },
        sweep: { kind: "purge" },
        verb: "Deleting",
      });
    },
    remove: async (target: Target) => {
      const went: string[] = [];
      await bulk(target, {
        action: () => ({
          label: "Undo",
          onClick: () => {
            void restoreItems({ ids: went, kind: "ids" });
          },
        }),
        done: (count) => `Moved ${plural(count, "item")} to Deleted.`,
        past: "deleted",
        run: async (chunk) => {
          const { deleted } = await remove.mutateAsync({ ids: [...chunk] });
          went.push(...deleted);

          return deleted.length;
        },
        sweep: { kind: "delete" },
        verb: "Deleting",
      });
    },
    restore: restoreItems,
    refresh: (id: string) => {
      refresh.mutate({ id });
    },
    saveLinks: async (
      links: readonly CapturedLink[],
      into: SaveInto,
      open: (id: string) => void,
    ) => {
      const made: { readonly created: boolean; readonly id: string }[] = [];
      await runBulk({
        action: () => {
          const [only, ...more] = made;

          return only === undefined || more.length > 0
            ? undefined
            : {
                label: "Open",
                onClick: () => {
                  open(only.id);
                },
              };
        },
        chunk: 1,
        done: (count) => {
          if (count > 1) {
            return `Saved ${plural(count, "link")}.`;
          }

          return made[0]?.created === false ? "Your library already holds that link." : "Saved.";
        },
        items: links,
        noun: "link",
        past: "saved",
        run: async (chunk) => {
          for (const { title, url } of chunk) {
            const link = {
              parent: into.parentId === null ? null : { id: into.parentId },
              tags: [...into.tags],
              url,
            };

            const { created, item } = await saveLink.mutateAsync(
              title === null ? link : { ...link, title },
            );

            made.push({ created, id: item.id });
          }

          return chunk.length;
        },
        verb: "Saving",
      });
    },
    tag: async (target: Target, change: TagChange) => {
      const tags = { addTags: [...change.add], removeTags: [...change.remove] };
      await bulk(target, {
        done: (count) => `Tagged ${plural(count, "item")}.`,
        past: "tagged",
        run: async (chunk) => {
          const { items } = await organize.mutateAsync({ ...tags, ids: [...chunk] });

          return items.length;
        },
        sweep: { ...tags, kind: "organize" },
        verb: "Tagging",
      });
    },

    createFolder: (name: string, parentId: string | null, kind: "folder" | "list" = "folder") => {
      writeContainers.mutate({ id: newId(), kind, op: "create", parentId, title: name });
    },
    deleteFolder: (parentId: string) => {
      writeContainers.mutate({ id: parentId, op: "delete" });
    },
    removeView: (id: string) => {
      removeView.mutate({ id, opId: newId() });
    },
    saveView: (view: SavedView) => {
      saveView.mutate({ opId: newId(), view });
    },
    renameFolder: (parentId: string, name: string) => {
      const held = containers().find((container) => container.id === parentId);

      if (held !== undefined && held.title !== name) {
        writeContainers.mutate({ id: parentId, op: "rename", title: name });
      }
    },
  };
};

export type LibraryVerbs = ReturnType<typeof useLibraryVerbs>;
