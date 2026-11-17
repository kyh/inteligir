// What a command does to the cell (`./library-commands.tsx`), over the writes
// `../cloud/library-writes.ts` holds. A verb over several items or several saves is one run that
// says how it went (`./bulk-actions.ts`), and one over a scope the grid read only in part is one
// ask the cell lands in the call; a new note answers its caller, and a folder's write says its own
// refusal.

import type { InferClientInputs } from "@orpc/client";
import { BULK_ITEMS_MAX } from "@repo/contract/library/library-wire";
import { ordBetween } from "@repo/contract/library/order-key";
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
import { newId } from "./new-id";

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
  const writeFolders = useMutation(writes.folders());
  const refresh = useMutation(writes.refresh());
  const createNote = useMutation(writes.createNote());
  const saveLink = useMutation(writes.saveLink());
  const addFile = useMutation(writes.addFile());

  const folders = () =>
    queryClient.getQueryData(orpc.library.listing.scopes.queryKey())?.folders ?? [];

  // A verb over its target, answering how many items a rule left as they were. Items by id go in
  // the chunks their route takes, as one run; a scope is one ask (`sweep`), which lands in the call
  // and names the items it left
  const bulk = async (
    target: Target,
    job: Omit<BulkRun<string>, "chunk" | "items"> & { readonly sweep: SweepVerb },
  ): Promise<number> => {
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

  const restoreItems = async (target: Target): Promise<void> => {
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
    addFiles: async (files: readonly File[], into: SaveInto): Promise<void> => {
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
    // an empty note made, answering its id
    createNote: async (into: SaveInto): Promise<string> => await createNote.mutateAsync({ into }),
    move: async (target: Target, folderId: string | null): Promise<void> => {
      const folder = folderId === null ? null : { id: folderId };
      await bulk(target, {
        done: (count) => `Moved ${plural(count, "item")}.`,
        past: "moved",
        run: async (chunk) => {
          const { items } = await organize.mutateAsync({ folder, ids: [...chunk] });
          return items.length;
        },
        sweep: { folder, kind: "organize" },
        verb: "Moving",
      });
    },
    pin: async (target: Target, pinned: boolean): Promise<void> => {
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
    purge: async (target: Target): Promise<void> => {
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
    // to Deleted, with an Undo of what went when the device named it
    remove: async (target: Target): Promise<void> => {
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
    // a saved page read again by the cloud's fill
    refresh: (id: string): void => {
      refresh.mutate({ id });
    },
    // each link where `into` saves, a lone one offering to open what it saved
    saveLinks: async (
      links: readonly CapturedLink[],
      into: SaveInto,
      open: (id: string) => void,
    ): Promise<void> => {
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
              folder: into.folderId === null ? null : { id: into.folderId },
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
    tag: async (target: Target, change: TagChange): Promise<void> => {
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

    createFolder: (name: string, parentId: string | null): void => {
      const siblings = folders()
        .filter((folder) => folder.parentId === parentId)
        .map((folder) => folder.sort)
        .toSorted();
      writeFolders.mutate({
        ops: [
          {
            id: newId(),
            name,
            op: "create",
            parentId,
            sort: ordBetween(siblings.at(-1) ?? null, null),
          },
        ],
      });
    },
    deleteFolder: (folderId: string): void => {
      writeFolders.mutate({ ops: [{ id: folderId, op: "delete" }] });
    },
    renameFolder: (folderId: string, name: string): void => {
      const held = folders().find((folder) => folder.id === folderId);
      if (held !== undefined && held.name !== name) {
        writeFolders.mutate({ ops: [{ base: held.name, id: folderId, name, op: "rename" }] });
      }
    },
  };
};

export type LibraryVerbs = ReturnType<typeof useLibraryVerbs>;
