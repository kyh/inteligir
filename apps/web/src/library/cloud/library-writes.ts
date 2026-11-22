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

type Container = ScopesAnswer["containers"][number];

export type ContainerOp =
  | {
      readonly op: "create";
      readonly id: string;
      readonly kind: Container["kind"];
      readonly parentId: string | null;
      readonly title: string;
    }
  | { readonly op: "rename"; readonly id: string; readonly title: string }
  | { readonly op: "move"; readonly id: string; readonly parentId: string | null }
  | { readonly op: "delete"; readonly id: string };

interface Overlay {
  readonly row: (row: ListedItem) => ListedItem | null;
  readonly item: (item: ItemAnswer) => ItemAnswer;
}

type Change<T> =
  | {
      readonly kind: "held";
      readonly id: string;
      readonly at: number;
      readonly before: T;
      readonly laid: T | undefined;
    }
  | { readonly kind: "added"; readonly id: string; readonly laid: T };

const changesIn = <T extends { readonly id: string }>(
  before: readonly T[],
  after: readonly T[],
) => {
  const left = new Map(after.map((entry) => [entry.id, entry]));
  const had = new Set(before.map((entry) => entry.id));

  return [
    ...before.flatMap((entry, at) => {
      const laid = left.get(entry.id);

      return (
        laid === entry ? [] : [{ at, before: entry, id: entry.id, kind: "held", laid }]
      ) satisfies Change<T>[];
    }),
    ...after.flatMap(
      (laid) =>
        (had.has(laid.id) ? [] : [{ id: laid.id, kind: "added", laid }]) satisfies Change<T>[],
    ),
  ] satisfies Change<T>[];
};

const undoneIn = <T extends { readonly id: string }>(
  list: readonly T[],
  changes: readonly Change<T>[],
) => {
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
) => {
  const listings = { queryKey: orpc.library.listing.page.key({ type: "infinite" }) };
  const items = { queryKey: orpc.library.items.row.key() };
  await Promise.all([queryClient.cancelQueries(listings), queryClient.cancelQueries(items)]);

  const laidRows = (rows: readonly ListedItem[]) =>
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

const putBack = (queryClient: QueryClient, laid: Laid | undefined) => {
  notifyManager.batch(() => {
    for (const { pages, queryKey } of laid?.listings ?? []) {
      queryClient.setQueryData<InfiniteData<ListingAnswer>>(queryKey, (data) => {
        if (data === undefined) {
          return data;
        }

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

const knownParentId = (parent: OrganizeInput["parent"]) => {
  if (parent === undefined || parent === null) {
    return parent;
  }

  return "id" in parent ? parent.id : undefined;
};

export const organizedOverlay = (input: OrganizeInput) => {
  const removed = new Set((input.removeTags ?? []).map((tag) => tag.toLowerCase()));

  const retagged = (tags: readonly string[]) =>
    mergeListField(
      "tags",
      tags.filter((tag) => !removed.has(tag.toLowerCase())),
      [],
      input.addTags ?? [],
    );

  const parentId = knownParentId(input.parent);
  const now = Date.now();

  const fields = (held: LibraryItemFields) => organized(held, input, parentId, now);

  const retitled = <C extends { readonly title: string }>(card: C) =>
    (input.title === undefined ? card : { ...card, title: input.title }) satisfies C;

  return {
    item: (item) => ({ ...item, card: retitled(item.card), fields: fields(item.fields) }),
    row: (row) => ({
      ...row,
      card: retitled(row.card),
      fields: fields(row.fields),
      tags: retagged(row.tags),
    }),
  } satisfies Overlay;
};

const fieldsOverlay = (ops: readonly PropertyOp[]) => {
  const landed = (fields: LibraryItemFields) => {
    const outcome = applyPropertyOps(fields, ops);

    return outcome.kind === "applied" ? outcome.fields : fields;
  };

  return {
    item: (item) => ({ ...item, fields: landed(item.fields) }),
    row: (row) => ({ ...row, fields: landed(row.fields) }),
  } satisfies Overlay;
};

const deletedAt = (at: number | null) =>
  ({
    item: (item) => ({ ...item, fields: { ...item.fields, deletedAt: at } }),
    row: () => null,
  }) satisfies Overlay;

const deletedNow = () => deletedAt(Date.now());

const PURGED: Overlay = { item: (item) => item, row: () => null };

const listOverlay = (list: Inputs["items"]["setList"]["list"]) =>
  ({
    item: (item) => ({ ...item, fields: { ...item.fields, list } }),
    row: (row) => ({ ...row, fields: { ...row.fields, list } }),
  }) satisfies Overlay;

const containersAfter = (scopes: ScopesAnswer, op: ContainerOp) => {
  switch (op.op) {
    case "create": {
      const { id, kind, parentId, title } = op;

      return {
        ...scopes,
        containers: [...scopes.containers, { id, items: 0, kind, parentId, title }],
      } satisfies ScopesAnswer;
    }

    case "rename": {
      return {
        ...scopes,
        containers: scopes.containers.map((held) =>
          held.id === op.id ? { ...held, title: op.title } : held,
        ),
      } satisfies ScopesAnswer;
    }

    case "move": {
      return {
        ...scopes,
        containers: scopes.containers.map((held) =>
          held.id === op.id ? { ...held, parentId: op.parentId } : held,
        ),
      } satisfies ScopesAnswer;
    }

    case "delete": {
      const gone = new Set([op.id]);

      for (const held of scopes.containers) {
        if (held.parentId !== null && gone.has(held.parentId)) {
          gone.add(held.id);
        }
      }

      return {
        ...scopes,
        containers: scopes.containers.filter((held) => !gone.has(held.id)),
      } satisfies ScopesAnswer;
    }

    default: {
      throw new Error(`unexpected ${String(op satisfies never)}`);
    }
  }
};

type Settled = NonNullable<MutationOptions<unknown, unknown, unknown>["onSettled"]>;

export interface SaveInto {
  readonly parentId: string | null;
  readonly tags: readonly string[];
}

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
  const readAgainAfter = (queued: boolean) =>
    (async (_data, _error, _input, _held, { client: queryClient }) => {
      if (queryClient.isMutating({ predicate: inLibraryQueue }) > (queued ? 1 : 0)) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.library.listing.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.library.items.row.key() }),
      ]);
    }) satisfies Settled;

  const readAgain = readAgainAfter(true);
  const readAgainSaved = readAgainAfter(false);

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
    ) => {
      putBack(queryClient, laid);

      if (failed !== null) {
        toast.error(refusalText(cause, failed));
      }
    },
    onMutate: async (input: I, { client: queryClient }: MutationFunctionContext) =>
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
    writeFields: () =>
      orpc.library.write.mutationOptions(
        overlaid(
          (input: Inputs["write"]) => [input.itemId],
          (input) => fieldsOverlay(input.ops),
          "That couldn't be changed.",
        ),
      ),
    setList: () =>
      orpc.library.items.setList.mutationOptions(
        overlaid(
          (input: Inputs["items"]["setList"]) => [input.id],
          (input) => listOverlay(input.list),
          "That list couldn't be changed.",
        ),
      ),
    containers: () =>
      mutationOptions<unknown, Error, ContainerOp, readonly Change<Container>[]>({
        mutationFn: async (op: ContainerOp) => {
          switch (op.op) {
            case "create": {
              return await client.library.items.create({
                blocks: [],
                id: op.id,
                kind: op.kind,
                parentId: op.parentId,
                savedAt: Date.now(),
                tags: [],
                title: op.title,
              });
            }

            case "rename": {
              return await client.library.items.organize({ ids: [op.id], title: op.title });
            }

            case "move": {
              return await client.library.items.organize({
                ids: [op.id],
                parent: op.parentId === null ? null : { id: op.parentId },
              });
            }

            case "delete": {
              return await client.library.items.delete({ ids: [op.id] });
            }

            default: {
              throw new Error(`unexpected ${String(op satisfies never)}`);
            }
          }
        },
        onError: (cause, _op, changes, { client: queryClient }) => {
          queryClient.setQueryData(orpc.library.listing.scopes.queryKey(), (scopes) =>
            scopes === undefined || changes === undefined
              ? scopes
              : { ...scopes, containers: undoneIn(scopes.containers, changes) },
          );
          toast.error(refusalText(cause, "That folder couldn't be changed."));
        },
        onMutate: async (op, { client: queryClient }) => {
          const scopesKey = orpc.library.listing.scopes.queryKey();
          await queryClient.cancelQueries({ queryKey: scopesKey });
          const before = queryClient.getQueryData(scopesKey);

          if (before === undefined) {
            return [];
          }

          const after = queryClient.setQueryData(scopesKey, containersAfter(before, op));

          return changesIn(before.containers, after?.containers ?? before.containers);
        },
        onSettled: readAgain,
        scope: LIBRARY_WRITES,
      }),
    refresh: () =>
      orpc.library.items.refresh.mutationOptions({
        onError: (cause) => {
          toast.error(refusalText(cause, "The page couldn't be read again."));
        },
        onSuccess: () => {
          toast.success("Reading the page again. Its text lands soon.");
        },
      }),
    createNote: () =>
      mutationOptions({
        mutationFn: async ({ into, note = EMPTY_NOTE }: { into: SaveInto; note?: NoteMade }) => {
          const { item } = await client.library.items.create({
            blocks: note.blocks.map((block) => ({ block, section: "note" })),
            parentId: into.parentId,
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
            parentId: into.parentId,
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
    sweep: () => orpc.library.items.sweep.mutationOptions({ scope: LIBRARY_WRITES }),
  };
};
