// The library's writes as mutation options beside its reads (`./library-queries.ts`), each mounted
// by the screen that asks for it. A pin, a move, a tag, a title, a delete or a restore is laid over
// every listing and item on screen at once, its items alone put back if the cell refuses it, and
// read again once it and every write behind it settled; a folder's write likewise over the rail's
// folders. The writes share one scope, so they land in the order they were asked; a save makes an
// item of its own and waits on none of them.
//
// CLAUDE.md § A write is mutation options beside the reads, and says how it went once. A write
// handed the sentence its refusal reads says it from its options, which run with the mutation
// however soon the screen that asked goes; any other is a flow's, which awaits it and says how the
// whole run went.

import type { InferClientInputs, InferClientOutputs } from "@orpc/client";
import { inLibraryQueue, LIBRARY_WRITES } from "@repo/client/library-cache";
import type { V1Queries } from "@repo/client/library-cache";
import { keptFileType } from "@repo/contract/items/item-kind";
import { organized } from "@repo/contract/library/cell-rules";
import { applyPropertyOps, mergeListField } from "@repo/contract/library/field-ops";
import type { PropertyOp } from "@repo/contract/library/field-ops";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { toast } from "@repo/ui/components/sonner";
import { mutationOptions, notifyManager } from "@tanstack/react-query";
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
type Folder = ScopesAnswer["folders"][number];

interface Overlay {
  // a listed row as the write leaves it; null when the write takes it out of every listing
  readonly row: (row: ListedItem) => ListedItem | null;
  readonly item: (item: ItemAnswer) => ItemAnswer;
}

// one entry of a list a write changed, by its id: one the list held, as it stood and where, and as
// the write left it, undefined where the write took it out; or one the write added
type Change<T> =
  | {
      readonly kind: "held";
      readonly id: string;
      readonly at: number;
      readonly before: T;
      readonly laid: T | undefined;
    }
  | { readonly kind: "added"; readonly id: string; readonly laid: T };

// what a write changed in a list, entry by entry, as the query holds it after: a query shares its
// data structurally, so an entry the write left alone is still the object it was
const changesIn = <T extends { readonly id: string }>(
  before: readonly T[],
  after: readonly T[],
): Change<T>[] => {
  const left = new Map(after.map((entry) => [entry.id, entry]));
  const had = new Set(before.map((entry) => entry.id));
  return [
    ...before.flatMap((entry, at): Change<T>[] => {
      const laid = left.get(entry.id);
      return laid === entry ? [] : [{ at, before: entry, id: entry.id, kind: "held", laid }];
    }),
    ...after.flatMap((laid): Change<T>[] =>
      had.has(laid.id) ? [] : [{ id: laid.id, kind: "added", laid }],
    ),
  ];
};

// a list with a refused write's changes taken back, each only where the list still shows it as the
// write left it: an entry a read or a later write has changed since is theirs. Every write is laid
// over the screen as it is asked, before those ahead of it land, so undoing more would undo theirs
const undoneIn = <T extends { readonly id: string }>(
  list: readonly T[],
  changes: readonly Change<T>[],
): T[] => {
  const next = [...list];
  for (const change of changes) {
    const index = next.findIndex((entry) => entry.id === change.id);
    if ((index === -1 ? undefined : next[index]) !== change.laid) {
      continue;
    }
    if (index !== -1) {
      next.splice(index, 1);
    }
    if (change.kind === "held") {
      next.splice(index === -1 ? Math.min(change.at, next.length) : index, 0, change.before);
    }
  }
  return next;
};

// what a write changed on screen, taken back if the cell refuses it: each listing's rows a page at
// a time, and each item it was laid over
interface Laid {
  readonly listings: readonly {
    readonly queryKey: QueryKey;
    readonly pages: readonly (readonly Change<ListedItem>[])[];
  }[];
  readonly items: readonly {
    readonly queryKey: QueryKey;
    readonly before: ItemAnswer;
    readonly laid: ItemAnswer;
  }[];
}

const layOver = async (
  queryClient: QueryClient,
  orpc: V1Queries,
  ids: ReadonlySet<string>,
  overlay: Overlay,
): Promise<Laid> => {
  const listings = { queryKey: orpc.library.listing.page.key({ type: "infinite" }) };
  const items = { queryKey: orpc.library.items.row.key() };
  await Promise.all([queryClient.cancelQueries(listings), queryClient.cancelQueries(items)]);
  const laidRows = (rows: readonly ListedItem[]): ListedItem[] =>
    rows.flatMap((row) => {
      if (!ids.has(row.id)) {
        return [row];
      }
      const laid = overlay.row(row);
      return laid === null ? [] : [laid];
    });
  return notifyManager.batch(() => ({
    items: queryClient.getQueriesData<ItemAnswer>(items).flatMap(([queryKey, before]) => {
      if (before === undefined || !ids.has(before.id)) {
        return [];
      }
      const laid = queryClient.setQueryData<ItemAnswer>(queryKey, overlay.item(before));
      return laid === undefined ? [] : [{ before, laid, queryKey }];
    }),
    listings: queryClient
      .getQueriesData<InfiniteData<ListingAnswer>>(listings)
      .flatMap(([queryKey, before]) => {
        if (before === undefined) {
          return [];
        }
        const after = queryClient.setQueryData<InfiniteData<ListingAnswer>>(queryKey, {
          ...before,
          pages: before.pages.map((page) => ({ ...page, items: laidRows(page.items) })),
        });
        const pages = before.pages.map((page, index) =>
          changesIn(page.items, after?.pages[index]?.items ?? page.items),
        );
        return pages.some((changes) => changes.length > 0) ? [{ pages, queryKey }] : [];
      }),
  }));
};

const putBack = (queryClient: QueryClient, laid: Laid | undefined): void => {
  notifyManager.batch(() => {
    for (const { pages, queryKey } of laid?.listings ?? []) {
      queryClient.setQueryData<InfiniteData<ListingAnswer>>(queryKey, (data) => {
        if (data === undefined) {
          return data;
        }
        // a row the write took out that a read has listed since, on any page, stays where it is
        const listed = new Set(data.pages.flatMap((page) => page.items.map((row) => row.id)));
        return {
          ...data,
          pages: data.pages.map((page, index) => ({
            ...page,
            items: undoneIn(
              page.items,
              (pages[index] ?? []).filter(
                (change) => change.laid !== undefined || !listed.has(change.id),
              ),
            ),
          })),
        };
      });
    }
    for (const { before, laid: shown, queryKey } of laid?.items ?? []) {
      if (queryClient.getQueryData(queryKey) === shown) {
        queryClient.setQueryData<ItemAnswer>(queryKey, before);
      }
    }
  });
};

// the folder an organize files into as the screen can know it before the cell answers: a path's
// folder may be one the call makes, so the item stays where it is until the read after it lands
const knownFolderId = (folder: OrganizeInput["folder"]): string | null | undefined => {
  if (folder === undefined || folder === null) {
    return folder;
  }
  return "id" in folder ? folder.id : undefined;
};

// an organize's fields by the cell's own rule; a row's tags, which add its body's to its field's,
// merge by their own
export const organizedOverlay = (input: OrganizeInput): Overlay => {
  const removed = new Set((input.removeTags ?? []).map((tag) => tag.toLowerCase()));
  const retagged = (tags: readonly string[]): string[] =>
    mergeListField(
      "tags",
      tags.filter((tag) => !removed.has(tag.toLowerCase())),
      [],
      input.addTags ?? [],
    );
  const folderId = knownFolderId(input.folder);
  const now = Date.now();
  const fields = (held: LibraryItemFields): LibraryItemFields =>
    organized(held, input, folderId, now);
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
  // once a write settles, landed or refused, whatever it answered, while no other write in the
  // library's queue waits: one waiting is laid over the screen but not sent yet, so a read now would
  // take it off until it lands, and its own read once it settles reads this one's too. A write in
  // the queue is still waiting itself while it settles
  const readAgainAfter =
    (queued: boolean): Settled =>
    async (_data, _error, _input, _held, { client: queryClient }) => {
      if (queryClient.isMutating({ predicate: inLibraryQueue }) > (queued ? 1 : 0)) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.library.listing.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.library.items.row.key() }),
      ]);
    };
  const readAgain = readAgainAfter(true);
  // a save makes an item of its own, outside the queue
  const readAgainSaved = readAgainAfter(false);

  // a write in the library's queue, laid over the items it names the moment it is asked, those
  // put back if the cell refuses it, saying `failed` then when no flow says how it went, and read
  // again once it settles
  const overlaid = <I>(
    idsOf: (input: I) => readonly string[],
    overlayOf: (input: I) => Overlay,
    failed: string | null,
  ) => ({
    onError: (
      cause: unknown,
      _input: I,
      laid: Laid | undefined,
      { client: queryClient }: MutationFunctionContext,
    ): void => {
      putBack(queryClient, laid);
      if (failed !== null) {
        toast.error(refusalText(cause, failed));
      }
    },
    onMutate: async (input: I, { client: queryClient }: MutationFunctionContext): Promise<Laid> =>
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
      orpc.library.folders.write.mutationOptions<readonly Change<Folder>[]>({
        onError: (cause, _input, changes, { client: queryClient }) => {
          queryClient.setQueryData(orpc.library.listing.scopes.queryKey(), (scopes) =>
            scopes === undefined || changes === undefined
              ? scopes
              : { ...scopes, folders: undoneIn(scopes.folders, changes) },
          );
          toast.error(refusalText(cause, "That folder couldn't be changed."));
        },
        onMutate: async ({ ops }, { client: queryClient }) => {
          const scopesKey = orpc.library.listing.scopes.queryKey();
          await queryClient.cancelQueries({ queryKey: scopesKey });
          const before = queryClient.getQueryData(scopesKey);
          if (before === undefined) {
            return [];
          }
          const after = queryClient.setQueryData(scopesKey, foldersAfter(before, ops));
          return changesIn(before.folders, after?.folders ?? before.folders);
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
        onSettled: readAgainSaved,
      }),
    saveLink: () => orpc.library.items.saveLink.mutationOptions({ onSettled: readAgainSaved }),
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
        onSettled: readAgainSaved,
      }),
    // a verb over every item a scope lists, which the cell lands after it answers: what moved
    // names each lot as it lands
    sweep: () => orpc.library.items.sweep.mutationOptions({ scope: LIBRARY_WRITES }),
  };
};

export type LibraryWrites = ReturnType<typeof libraryWrites>;
