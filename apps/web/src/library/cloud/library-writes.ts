// The library's writes as mutation options beside its reads (`./library-queries.ts`), each mounted
// by the screen that asks for it. A pin, a move, a tag, a title, a delete or a restore is laid over
// every listing and item on screen at once, put back if the cell refuses it, and read again once it
// lands; a folder's write likewise over the rail's scopes. The writes share one scope, so they land
// in the order they were asked; a save makes an item of its own and waits on none of them.
//
// CLAUDE.md § A write is mutation options beside the reads, and says how it went once. A write
// handed the sentence its refusal reads says it from its options, which run with the mutation
// however soon the screen that asked goes; any other is a flow's, which awaits it and says how the
// whole run went.

import type { InferClientInputs, InferClientOutputs } from "@orpc/client";
import type { V1Queries } from "@repo/client/library-cache";
import { keptFileType } from "@repo/contract/items/item-kind";
import { applyPropertyOps, mergeListField } from "@repo/contract/library/field-ops";
import type { PropertyOp } from "@repo/contract/library/field-ops";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { toast } from "@repo/ui/components/sonner";
import { mutationOptions } from "@tanstack/react-query";
import type {
  InfiniteData,
  MutationFunctionContext,
  MutationOptions,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";

import type { ListedItem } from "../library/listing";
import { newId } from "../library/new-id";
import { uploadFile } from "./library-files";
import type { FileCloud } from "./library-files";
import type { CloudWire } from "./v1";

type Outputs = InferClientOutputs<V1Client>["library"];
type Inputs = InferClientInputs<V1Client>["library"];
type ListingAnswer = Outputs["listing"]["page"];
type ItemAnswer = Outputs["items"]["row"];
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
  const items = { queryKey: orpc.library.items.row.key() };
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

const putBack = (queryClient: QueryClient, held: Held | undefined): void => {
  for (const [queryKey, data] of held ?? []) {
    queryClient.setQueryData(queryKey, data);
  }
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

// an item's property ops as the cell lands them, over the fields the screen holds; a batch that
// would not land leaves them as they are, for the read after the refusal to settle
const fieldsOverlay = (ops: readonly PropertyOp[]): Overlay => {
  const landed = (fields: LibraryItemFields): LibraryItemFields => {
    const outcome = applyPropertyOps(fields, ops);
    return outcome.kind === "applied" ? outcome.fields : fields;
  };
  return {
    item: (item) => ({ ...item, fields: landed(item.fields) }),
    row: (row) => ({ ...row, fields: landed(row.fields) }),
  };
};

const deletedAt = (at: number | null): Overlay => ({
  item: (item) => ({ ...item, fields: { ...item.fields, deletedAt: at } }),
  row: () => null,
});

const deletedNow = (): Overlay => deletedAt(Date.now());

const PURGED: Overlay = { item: (item) => item, row: () => null };

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

type Settled = NonNullable<MutationOptions<unknown, unknown, unknown>["onSettled"]>;

// where a save lands: the grid's folder, else none, and the tag it shows
export interface SaveInto {
  readonly folderId: string | null;
  readonly tags: readonly string[];
}

// a note's title and blocks as it is made: what the editor moved out of an item, or none of
// either for New note
interface NoteMade {
  readonly title: string;
  readonly blocks: readonly LibraryBlock[];
}

const EMPTY_NOTE: NoteMade = { blocks: [], title: "" };

export const libraryWrites = ({
  cloud,
  wire: { client, orpc },
}: {
  readonly cloud: FileCloud;
  readonly wire: CloudWire;
}) => {
  // once a write settles, landed or refused, whatever it answered
  const readAgain: Settled = async (_data, _error, _input, _held, { client: queryClient }) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.library.listing.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.library.items.row.key() }),
    ]);
  };

  // a write in the library's queue, laid over the items it names the moment it is asked, put back
  // if the cell refuses it, saying `failed` then when no flow says how it went, and read again once
  // it settles
  const overlaid = <I>(
    idsOf: (input: I) => readonly string[],
    overlayOf: (input: I) => Overlay,
    failed: string | null,
  ) => ({
    onError: (
      cause: unknown,
      _input: I,
      held: Held | undefined,
      { client: queryClient }: MutationFunctionContext,
    ): void => {
      putBack(queryClient, held);
      if (failed !== null) {
        toast.error(refusalText(cause, failed));
      }
    },
    onMutate: async (input: I, { client: queryClient }: MutationFunctionContext): Promise<Held> =>
      await layOver(queryClient, orpc, new Set(idsOf(input)), overlayOf(input)),
    onSettled: readAgain,
    scope: LIBRARY_WRITES,
  });

  return {
    organize: (failed: string | null = null) =>
      orpc.library.items.organize.mutationOptions(
        overlaid((input: OrganizeInput) => input.ids, organizedOverlay, failed),
      ),
    remove: () =>
      orpc.library.items.delete.mutationOptions(
        overlaid((input: Inputs["items"]["delete"]) => input.ids, deletedNow, null),
      ),
    restore: () =>
      orpc.library.items.restore.mutationOptions(
        overlaid(
          (input: Inputs["items"]["restore"]) => input.ids,
          () => deletedAt(null),
          null,
        ),
      ),
    purge: () =>
      orpc.library.items.purge.mutationOptions(
        overlaid(
          (input: Inputs["items"]["purge"]) => input.ids,
          () => PURGED,
          null,
        ),
      ),
    // property ops on one item, each over the value the screen showed
    writeFields: () =>
      orpc.library.write.mutationOptions(
        overlaid(
          (input: Inputs["write"]) => [input.itemId],
          (input) => fieldsOverlay(input.ops),
          "That couldn't be changed.",
        ),
      ),
    folders: () =>
      orpc.library.folders.write.mutationOptions<Held>({
        onError: (cause, _input, held, { client: queryClient }) => {
          putBack(queryClient, held);
          toast.error(refusalText(cause, "That folder couldn't be changed."));
        },
        onMutate: async ({ ops }, { client: queryClient }) => {
          const scopesKey = orpc.library.listing.scopes.queryKey();
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
    // a saved page read again by the cloud's fill
    refresh: () =>
      orpc.library.items.refresh.mutationOptions({
        onError: (cause) => {
          toast.error(refusalText(cause, "The page couldn't be read again."));
        },
        onSuccess: () => {
          toast.success("Reading the page again. Its text lands soon.");
        },
      }),
    // a note made where `into` saves, answering its id
    createNote: () =>
      mutationOptions({
        mutationFn: async ({
          into,
          note = EMPTY_NOTE,
        }: {
          into: SaveInto;
          note?: NoteMade;
        }): Promise<string> => {
          const { item } = await client.library.items.create({
            blocks: note.blocks.map((block) => ({ block, section: "note" })),
            folderId: into.folderId,
            id: newId(),
            savedAt: Date.now(),
            tags: [...into.tags],
            title: note.title,
          });
          return item.id;
        },
        onSettled: readAgain,
      }),
    saveLink: () => orpc.library.items.saveLink.mutationOptions({ onSettled: readAgain }),
    addFile: () =>
      mutationOptions({
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
      }),
    // a verb over every item a scope lists, which the cell lands after it answers: what moved
    // names each lot as it lands
    sweep: () => orpc.library.items.sweep.mutationOptions({ scope: LIBRARY_WRITES }),
  };
};

export type LibraryWrites = ReturnType<typeof libraryWrites>;
