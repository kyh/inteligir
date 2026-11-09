// What the grid, its menu, Info, the palette and the window's saves do to the library, each a
// mutation the cell answers. A pin, a move, a tag, a title, a delete or a restore is laid over every
// listing and item on screen at once, put back if the cell refuses it, and read again once it
// lands; a folder's write likewise over the rail's scopes. The writes share one scope, so they land
// in the order they were asked; a save makes an item of its own and waits on none of them.

import type { InferClientInputs, InferClientOutputs } from "@orpc/client";
import { refusalText } from "@repo/contract/refusal-text";
import { BULK_ITEMS_MAX, LISTING_PAGE_MAX } from "@repo/contract/library/library-wire";
import type { V1Client } from "@repo/contract/v1";
import { keptFileType } from "@repo/contract/items/item-kind";
import { mergeListField } from "@repo/contract/library/block-ops";
import { ordBetween } from "@repo/contract/library/block-order";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";

import { useCloud, useWire } from "../cloud/library-context";
import { uploadFile } from "../cloud/library-files";
import type { V1Queries } from "../cloud/v1";
import { runBulk } from "./bulk-actions";
import type { ListedItem } from "./listing";
import { newId } from "./new-id";

type Outputs = InferClientOutputs<V1Client>["library"];
type Inputs = InferClientInputs<V1Client>["library"];
type ListingAnswer = Outputs["listing"]["page"];
type ItemAnswer = Outputs["items"]["get"];
type ScopesAnswer = Outputs["listing"]["scopes"];
type OrganizeInput = Inputs["items"]["organize"];
type FolderOp = Inputs["folders"]["write"]["ops"][number];

// one queue for every write to the library's items and folders
const LIBRARY_WRITES = { id: "library" };

// what screens held before a write was laid over them, put back if the cell refuses it
type Held = readonly (readonly [QueryKey, unknown])[];

interface Overlay {
  // a listed row as the write leaves it; null when the write takes it out of every listing
  readonly row: (row: ListedItem) => ListedItem | null;
  readonly item: (item: ItemAnswer) => ItemAnswer;
}

const layOver = async (
  queryClient: QueryClient,
  orpc: V1Queries,
  ids: ReadonlySet<string>,
  overlay: Overlay,
): Promise<Held> => {
  const listings = { queryKey: orpc.library.listing.page.key({ type: "infinite" }) };
  const items = { queryKey: orpc.library.items.get.key() };
  await Promise.all([queryClient.cancelQueries(listings), queryClient.cancelQueries(items)]);
  const held = [...queryClient.getQueriesData(listings), ...queryClient.getQueriesData(items)];
  queryClient.setQueriesData<InfiniteData<ListingAnswer>>(listings, (data) =>
    data === undefined
      ? data
      : {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.flatMap((row) => {
              if (!ids.has(row.id)) {
                return [row];
              }
              const laid = overlay.row(row);
              return laid === null ? [] : [laid];
            }),
          })),
        },
  );
  queryClient.setQueriesData<ItemAnswer>(items, (item) =>
    item === undefined || !ids.has(item.id) ? item : overlay.item(item),
  );
  return held;
};

const folderIdAfter = (folder: OrganizeInput["folder"], held: string | null): string | null => {
  if (folder === undefined) {
    return held;
  }
  if (folder === null) {
    return null;
  }
  return "id" in folder ? folder.id : held;
};

const pinnedAtAfter = (pinned: boolean | undefined, held: number | null): number | null => {
  if (pinned === undefined) {
    return held;
  }
  return pinned ? (held ?? Date.now()) : null;
};

/** @internal */
export const organizedOverlay = (input: OrganizeInput): Overlay => {
  const removed = new Set((input.removeTags ?? []).map((tag) => tag.toLowerCase()));
  const retagged = (tags: readonly string[]): string[] =>
    mergeListField(
      "tags",
      tags.filter((tag) => !removed.has(tag.toLowerCase())),
      [],
      input.addTags ?? [],
    );
  const fields = (held: LibraryItemFields): LibraryItemFields => ({
    ...held,
    folderId: folderIdAfter(input.folder, held.folderId),
    pinnedAt: pinnedAtAfter(input.pinned, held.pinnedAt),
    tags: retagged(held.tags),
    title: input.title ?? held.title,
  });
  const retitled = <C extends { readonly title: string }>(card: C): C =>
    input.title === undefined ? card : { ...card, title: input.title };
  return {
    item: (item) => ({ ...item, card: retitled(item.card), fields: fields(item.fields) }),
    row: (row) => ({
      ...row,
      card: retitled(row.card),
      fields: fields(row.fields),
      tags: retagged(row.tags),
    }),
  };
};

const deletedAt = (at: number | null): Overlay => ({
  item: (item) => ({ ...item, fields: { ...item.fields, deletedAt: at } }),
  row: () => null,
});

const deletedNow = (): Overlay => deletedAt(Date.now());

// the rail's folders as a write leaves them: a new one listed empty, a renamed one renamed, a
// deleted one gone with every folder under it
const foldersAfter = (scopes: ScopesAnswer, ops: readonly FolderOp[]): ScopesAnswer => {
  let folders = [...scopes.folders];
  for (const op of ops) {
    switch (op.op) {
      case "create": {
        const { id, name, parentId, sort } = op;
        folders.push({ id, items: 0, name, parentId, sort });
        break;
      }
      case "rename": {
        folders = folders.map((folder) =>
          folder.id === op.id ? { ...folder, name: op.name } : folder,
        );
        break;
      }
      case "delete": {
        const gone = new Set([op.id]);
        for (const folder of folders) {
          if (folder.parentId !== null && gone.has(folder.parentId)) {
            gone.add(folder.id);
          }
        }
        folders = folders.filter((folder) => !gone.has(folder.id));
        break;
      }
      case "move": {
        break;
      }
      // no default
    }
  }
  return { ...scopes, folders };
};

const chunked = <T>(items: readonly T[]): T[][] => {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += BULK_ITEMS_MAX) {
    chunks.push(items.slice(start, start + BULK_ITEMS_MAX));
  }
  return chunks;
};

export interface TagChange {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

// where a save lands: the grid's folder, else none, and the tag it shows
export interface SaveInto {
  readonly folderId: string | null;
  readonly tags: readonly string[];
}

export const useLibraryVerbs = () => {
  const { client, orpc } = useWire();
  const cloud = useCloud();
  const queryClient = useQueryClient();

  const readAgain = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.library.listing.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.library.items.get.key() }),
    ]);
  };
  const putBack = (held: Held | undefined): void => {
    for (const [queryKey, data] of held ?? []) {
      queryClient.setQueryData(queryKey, data);
    }
  };

  const organize = useMutation(
    orpc.library.items.organize.mutationOptions<Held>({
      onError: (_cause, _input, held) => {
        putBack(held);
      },
      onMutate: async (input) =>
        await layOver(queryClient, orpc, new Set(input.ids), organizedOverlay(input)),
      onSettled: readAgain,
      scope: LIBRARY_WRITES,
    }),
  );
  const remove = useMutation(
    orpc.library.items.delete.mutationOptions<Held>({
      onError: (_cause, _input, held) => {
        putBack(held);
      },
      onMutate: async ({ ids }) => await layOver(queryClient, orpc, new Set(ids), deletedNow()),
      onSettled: readAgain,
      scope: LIBRARY_WRITES,
    }),
  );
  const restore = useMutation(
    orpc.library.items.restore.mutationOptions<Held>({
      onError: (_cause, _input, held) => {
        putBack(held);
      },
      onMutate: async ({ ids }) => await layOver(queryClient, orpc, new Set(ids), deletedAt(null)),
      onSettled: readAgain,
      scope: LIBRARY_WRITES,
    }),
  );
  const purge = useMutation(
    orpc.library.items.purge.mutationOptions<Held>({
      onError: (_cause, _input, held) => {
        putBack(held);
      },
      onMutate: async ({ ids }) =>
        await layOver(queryClient, orpc, new Set(ids), { item: (item) => item, row: () => null }),
      onSettled: readAgain,
      scope: LIBRARY_WRITES,
    }),
  );
  const scopesKey = orpc.library.listing.scopes.queryKey();
  const writeFolders = useMutation(
    orpc.library.folders.write.mutationOptions<Held>({
      onError: (cause, _input, held) => {
        putBack(held);
        toast.error(refusalText(cause, "That folder couldn't be changed."));
      },
      onMutate: async ({ ops }) => {
        await queryClient.cancelQueries({ queryKey: scopesKey });
        const before = queryClient.getQueryData(scopesKey);
        queryClient.setQueryData(scopesKey, (scopes) =>
          scopes === undefined ? scopes : foldersAfter(scopes, ops),
        );
        return [[scopesKey, before]];
      },
      onSettled: readAgain,
      scope: LIBRARY_WRITES,
    }),
  );
  const create = useMutation(orpc.library.items.create.mutationOptions({ onSettled: readAgain }));
  const saveLink = useMutation(
    orpc.library.items.saveLink.mutationOptions({ onSettled: readAgain }),
  );
  const addFile = useMutation({
    mutationFn: async ({ file, into }: { file: File; into: SaveInto }) => {
      const sha = await uploadFile(
        cloud,
        new Uint8Array(await file.arrayBuffer()),
        keptFileType(file.type),
      );
      const { item } = await client.library.items.createFile({
        folderId: into.folderId,
        id: newId(),
        name: file.name,
        savedAt: Date.now(),
        sha,
        tags: [...into.tags],
      });
      return item;
    },
    onSettled: readAgain,
  });
  // a read a press acts on, so it waits for a connection as a write does
  const readDeleted = useMutation({
    mutationFn: async (): Promise<string[]> => {
      const ids: string[] = [];
      let cursor: number | undefined;
      do {
        const page = await client.library.listing.page({
          cursor,
          limit: LISTING_PAGE_MAX,
          query: { deleted: true, sort: "saved" },
        });
        ids.push(...page.items.map((row) => row.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return ids;
    },
    scope: LIBRARY_WRITES,
  });

  const folders = (): ScopesAnswer["folders"] => queryClient.getQueryData(scopesKey)?.folders ?? [];

  return {
    addFile: async (file: File, into: SaveInto) => await addFile.mutateAsync({ file, into }),
    // a note made with nothing in it yet, answering its id
    createNote: async (into: SaveInto): Promise<string> => {
      const { item } = await create.mutateAsync({
        blocks: [],
        folderId: into.folderId,
        id: newId(),
        savedAt: Date.now(),
        tags: [...into.tags],
        title: "",
      });
      return item.id;
    },
    deletedIds: async (): Promise<string[]> => await readDeleted.mutateAsync(),
    move: async (ids: readonly string[], folderId: string | null): Promise<void> => {
      await runBulk({
        chunk: BULK_ITEMS_MAX,
        done: (count) => `Moved ${plural(count, "item")}.`,
        items: ids,
        past: "moved",
        run: async (chunk) => {
          const { items } = await organize.mutateAsync({
            folder: folderId === null ? null : { id: folderId },
            ids: [...chunk],
          });
          return items.length;
        },
        verb: "Moving",
      });
    },
    pin: (ids: readonly string[], pinned: boolean): void => {
      for (const chunk of chunked(ids)) {
        organize.mutate(
          { ids: chunk, pinned },
          {
            onError: (cause) => {
              toast.error(refusalText(cause, "That couldn't be pinned."));
            },
          },
        );
      }
    },
    purge: async (ids: readonly string[]): Promise<void> => {
      await runBulk({
        chunk: BULK_ITEMS_MAX,
        done: (count) => `Deleted ${plural(count, "item")} forever.`,
        items: ids,
        past: "deleted",
        run: async (chunk) => {
          const { purged } = await purge.mutateAsync({ ids: [...chunk] });
          return purged.length;
        },
        verb: "Deleting",
      });
    },
    // answers how many went to Deleted
    remove: async (ids: readonly string[]): Promise<number> => {
      let deleted = 0;
      for (const chunk of chunked(ids)) {
        const answer = await remove.mutateAsync({ ids: chunk });
        deleted += answer.deleted.length;
      }
      return deleted;
    },
    restore: (ids: readonly string[]): void => {
      for (const chunk of chunked(ids)) {
        restore.mutate(
          { ids: chunk },
          {
            onError: (cause) => {
              toast.error(refusalText(cause, "That couldn't be restored."));
            },
            onSuccess: ({ addressHeld }) => {
              if (addressHeld.length > 0) {
                toast.info(
                  `${plural(addressHeld.length, "item")} stayed in Deleted: another item holds the same address.`,
                );
              }
            },
          },
        );
      }
    },
    retitle: (id: string, title: string): void => {
      organize.mutate(
        { ids: [id], title },
        {
          onError: (cause) => {
            toast.error(refusalText(cause, "The title couldn't be changed."));
          },
        },
      );
    },
    saveLink: async (url: string, title: string | null, into: SaveInto) => {
      const link = {
        folder: into.folderId === null ? null : { id: into.folderId },
        tags: [...into.tags],
        url,
      };
      const { created, item } = await saveLink.mutateAsync(
        title === null ? link : { ...link, title },
      );
      return { created, id: item.id };
    },
    tag: async (ids: readonly string[], change: TagChange): Promise<void> => {
      await runBulk({
        chunk: BULK_ITEMS_MAX,
        done: (count) => `Tagged ${plural(count, "item")}.`,
        items: ids,
        past: "tagged",
        run: async (chunk) => {
          const { items } = await organize.mutateAsync({
            addTags: [...change.add],
            ids: [...chunk],
            removeTags: [...change.remove],
          });
          return items.length;
        },
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
