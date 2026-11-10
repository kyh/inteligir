// An account's library cell as a client's suites need it, in memory: `/v1/rpc` served by oRPC's
// own handler over the rows a client writes through and the reads its screens make (an item whole,
// a listing's pages, the rail's counts and every title), and `/v1/blobs/<sha>`, each device
// reaching it through a transport of its own whose network a suite can take down or whose next
// answers it can lose after the cell acted. It keeps the rules a client leans on: a write lands
// only on the bases it names (`@repo/contract/library/field-ops`) and answers CONFLICT with what
// moved, an op id is answered once, a file must be uploaded before a write names it, every write
// takes the library's next sequence, and a read answers through the cell's own derivation and
// listing (`@repo/contract/library/derive-item`, `@repo/contract/library/library-index`). A suite
// seeds it without a call, and reads an item back as a listing or `items.get` answers it.

import { createORPCClient } from "@orpc/client";
import type { ClientContext, ClientLink } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { V1_BLOBS_PATH } from "../library/library-blobs";
import type {
  conflictCurrentSchema,
  folderOpSchema,
  listedItemSchema,
} from "../library/library-wire";
import { folderRowSchema, itemSummarySchema, liveItemRowSchema } from "../library/library-wire";
import { v1Contract, V1_RPC_PATH } from "../v1-contract";
import type { V1Client } from "../v1-contract";
import {
  BlobMissingError,
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  UnauthorizedError,
  V1_ERROR_STATUS_MAP,
} from "../v1-errors";
import { UNKNOWN_FILE_TYPE } from "../items/item-kind";
import { urlKey } from "../items/item-url";
import { applyFieldOps } from "../library/field-ops";
import type { FieldConflict, FieldOp } from "../library/field-ops";
import { compareText, ordBetween } from "../library/order-key";
import { deriveBody, deriveItem, titleKey } from "../library/derive-item";
import type { BodyBlock } from "../library/derive-item";
import { fileSha } from "../library/file-sha";
import {
  blankItemFields,
  fileFields,
  noteFields,
  pageFields,
  stubFields,
} from "../library/item-makes";
import {
  answerCard,
  itemListing,
  LibraryIndex,
  listedItem,
  listingPageOf,
} from "../library/library-index";
import type { ItemListing } from "../library/library-index";
import type { LibraryItemFields } from "../library/library-item";
import { uuidV7 } from "../library/uuid-v7";
import { clipSnippet } from "../text/clip-text";
import { mulberry32 } from "./seeded-random";
import { z } from "zod";

import type { V1Transport } from "../library/call-outcome";

type LiveRow = z.infer<typeof liveItemRowSchema>;
type ListedItem = z.infer<typeof listedItemSchema>;
type ConflictCurrent = z.infer<typeof conflictCurrentSchema>;
type FolderOp = z.infer<typeof folderOpSchema>;
type FolderRow = z.infer<typeof folderRowSchema>;
type HeldItem = LiveRow & { readonly blocks: BodyBlock[] };

// where a write files an item: a folder by its id or its path, none, or where it stands
type FolderTarget = { readonly id: string } | { readonly path: string } | null | undefined;

interface OrganizeInput {
  readonly ids: readonly string[];
  readonly addTags?: readonly string[] | undefined;
  readonly removeTags?: readonly string[] | undefined;
  readonly folder?: FolderTarget;
  readonly pinned?: boolean | undefined;
  readonly title?: string | undefined;
}

interface CellItem {
  readonly fields: LibraryItemFields;
  readonly blocks: readonly BodyBlock[];
  readonly seq: number;
  readonly updatedAt: number;
}

/** @internal */
export interface FakeDevice {
  readonly transport: V1Transport;
  // oRPC's link over that transport, for a client a suite builds as its host builds one
  readonly link: ClientLink<ClientContext>;
  // the same door as a client of the suite's own, for another writer's calls
  readonly client: V1Client;
  readonly setOffline: (offline: boolean) => void;
  // the next answers are lost after the cell acted on their requests
  readonly loseAnswers: (count: number) => void;
}

/** @internal */
export interface FakeCell {
  readonly device: (name: string) => FakeDevice;
  // rows put in place without a call, each landing as a write lands, under a fresh id
  readonly seed: {
    // a note filed nowhere, unless `fields` says otherwise
    readonly item: (fields?: Partial<LibraryItemFields>) => string;
    // a folder at the top, after the live ones there
    readonly folder: (name: string) => string;
  };
  // an item as `library.listing.page` lists it, and as `library.items.get` answers it
  readonly listed: (id: string) => ListedItem;
  readonly held: (id: string) => HeldItem;
  readonly item: (id: string) => CellItem | null;
  readonly items: () => ReadonlyMap<string, CellItem>;
  // each call, as `<device> <procedure>` (`library/write`), and each upload by sha
  readonly calls: string[];
  readonly uploads: string[];
  // every call is refused as a revoked sign-in
  readonly signOut: () => void;
}

const NOW = 1_700_000_100_000;
const ORIGIN = "https://cell.test";
const ID_SEED = 0x5e_ed;

// a save's words as the one paragraph the real cell's codec would read them into; blank words are
// none
const noteBlocks = (id: string, note: string | undefined): BodyBlock[] => {
  const blockId = `${id}-note`;
  return note === undefined || note.trim() === ""
    ? []
    : [{ block: { children: [{ text: note }], id: blockId, type: "p" }, section: "note" }];
};

// an item's card, tags and index text, over its body as the cell derives them
const derivedOf = (item: CellItem) => {
  const body = deriveBody(item.blocks);
  return { ...deriveItem(item.fields, body.digest), text: body.text };
};

// every sha the blocks a write carries name their bytes by
const SHA_KEY_RE = /"sha":"(?<sha>[0-9a-f]{64})"/gu;
const shasIn = (json: string): Set<string> =>
  new Set([...json.matchAll(SHA_KEY_RE)].flatMap((match) => match.groups?.sha ?? []));

const tagKey = (tag: string): string => tag.toLowerCase();

// an item as an organize answers it, concisely
const summaryOf = ({ card, fields, id }: LiveRow) => ({
  folderId: fields.folderId,
  id,
  kind: fields.kind,
  pinned: fields.pinnedAt !== null,
  savedAt: new Date(fields.savedAt).toISOString(),
  tags: [...fields.tags],
  title: card.title,
  url: fields.url,
});

// a folder as one op leaves it, at the sequence its write lands under
const folderAfter = (op: FolderOp, folder: FolderRow | null, seq: number): FolderRow | null => {
  if (op.op === "create") {
    return { deletedAt: null, id: op.id, name: op.name, parentId: op.parentId, seq, sort: op.sort };
  }
  if (folder === null) {
    return null;
  }
  switch (op.op) {
    case "rename": {
      return { ...folder, name: op.name, seq };
    }
    case "move": {
      return { ...folder, parentId: op.parentId, seq, sort: op.sort };
    }
    case "delete": {
      return { ...folder, deletedAt: NOW, seq };
    }
    // no default
  }
};

const throwConflicts = (current: readonly ConflictCurrent[]): void => {
  const [first, ...rest] = current;
  if (first !== undefined) {
    throw new ConflictError({ data: { current: [first, ...rest] } });
  }
};

const currentOf = (itemId: string, conflict: FieldConflict): ConflictCurrent => {
  switch (conflict.kind) {
    case "field": {
      return {
        current: z.json().parse(conflict.current),
        field: conflict.field,
        itemId,
        kind: "field",
      };
    }
    case "property": {
      return conflict.current === undefined
        ? { itemId, key: conflict.key, kind: "property" }
        : {
            current: z.json().parse(conflict.current),
            itemId,
            key: conflict.key,
            kind: "property",
          };
    }
    // no default
  }
};

/** @internal */
export const createFakeCell = (): FakeCell => {
  let head = 0;
  let signedOut = false;
  const items = new Map<string, CellItem>();
  const folders = new Map<string, FolderRow>();
  // each file's bytes, and its type as its upload named it
  const blobs = new Map<
    string,
    { readonly bytes: Uint8Array<ArrayBuffer>; readonly mime: string }
  >();
  const answers = new Map<string, unknown>();
  const calls: string[] = [];
  const uploads: string[] = [];

  // an id as a device mints one, drawn from the package's one seeded generator, so a run repeats
  const random = mulberry32(ID_SEED);
  let minted = 0;
  const mintId = (): string => {
    minted += 1;
    return uuidV7(
      NOW + minted,
      Uint8Array.from({ length: 16 }, () => Math.floor(random() * 256)),
    );
  };

  const liveRow = (id: string, item: CellItem): LiveRow => {
    const { card } = derivedOf(item);
    return {
      card: answerCard(card),
      fields: item.fields,
      id,
      kind: "live",
      seq: item.seq,
      updatedAt: item.updatedAt,
    };
  };

  // an item's listing row: it lists each tag it carries, its field's and its body's, once a
  // spelling, as the cell's tag rows hold them
  const listingRow = (id: string, item: CellItem): ItemListing => {
    const { card, tags } = derivedOf(item);
    return itemListing(
      { card, fields: item.fields, id, seq: item.seq, updatedAt: item.updatedAt },
      [...new Set(tags.map(({ tag }) => tag))].toSorted(compareText),
    );
  };

  // the cell's listing over every item and the live folders, built for the one read that asks
  const listing = (): LibraryIndex<ItemListing> => {
    const index = new LibraryIndex<ItemListing>();
    for (const [id, item] of items) {
      index.upsert(listingRow(id, item));
    }
    index.setFolders([...folders.values()].filter(({ deletedAt }) => deletedAt === null));
    return index;
  };

  // a search's hits on one side, each with the line holding its words. Only their exact text is
  // searched, ignoring case, and the hits rank in the order their items were made: the ranked
  // index, its stems and its weights are the Worker's suites' to hold
  const searchHits = (words: string, deleted: boolean): Map<string, string> => {
    const needle = words.toLowerCase();
    const hits = new Map<string, string>();
    for (const [id, item] of items) {
      const { search, text } = derivedOf(item);
      const line = [search.title, search.headings, search.meta, text]
        .flatMap((part) => part.split("\n"))
        .find((candidate) => candidate.toLowerCase().includes(needle));
      if ((item.fields.deletedAt !== null) === deleted && line !== undefined) {
        hits.set(id, clipSnippet(line.trim()));
      }
    }
    return hits;
  };

  const land = (id: string, fields: LibraryItemFields, blocks: readonly BodyBlock[]) => {
    head += 1;
    const item: CellItem = { blocks, fields, seq: head, updatedAt: NOW + head };
    items.set(id, item);
    return { item: liveRow(id, item) };
  };

  // an op id's first answer, every time it is asked again; a refusal is not kept
  const once = <T>(opId: string | undefined, schema: z.ZodType<T>, act: () => T): T => {
    const held = opId === undefined ? undefined : answers.get(opId);
    if (held !== undefined) {
      return schema.parse(held);
    }
    const answer = act();
    if (opId !== undefined) {
      answers.set(opId, answer);
    }
    return answer;
  };

  const needsBlobs = (shas: Iterable<string>): void => {
    const missing = [...shas].filter((sha) => !blobs.has(sha));
    const [first, ...rest] = missing;
    if (first !== undefined) {
      throw new BlobMissingError({ data: { shas: [first, ...rest] } });
    }
  };

  // the live item at an address, which a save of it answers
  const holderOf = (url: string): string | null => {
    const key = urlKey(url);
    for (const [id, item] of items) {
      const { deletedAt, url: address } = item.fields;
      if (key !== null && deletedAt === null && address !== null && urlKey(address) === key) {
        return id;
      }
    }
    return null;
  };

  // a write refused for leaving its item live at an address another live item holds
  const refuseHeldAddress = (itemId: string, fields: LibraryItemFields): void => {
    const holder = fields.url === null || fields.deletedAt !== null ? null : holderOf(fields.url);
    const item = holder === null || holder === itemId ? undefined : items.get(holder);
    if (holder !== null && item !== undefined) {
      throw new ConflictError({
        data: { current: [{ itemId: holder, kind: "item", seq: item.seq }] },
        message: "Another item in your library already holds this link.",
      });
    }
  };

  const write = (input: { readonly itemId: string; readonly ops: readonly FieldOp[] }) => {
    const item = items.get(input.itemId);
    if (item === undefined) {
      throw new NotFoundError();
    }
    needsBlobs(shasIn(JSON.stringify(input.ops)));
    const outcome = applyFieldOps(item.fields, input.ops);
    throwConflicts(
      outcome.kind === "conflict"
        ? outcome.conflicts.map((conflict) => currentOf(input.itemId, conflict))
        : [],
    );
    if (outcome.kind === "invalid") {
      throw new PayloadTooLargeError();
    }
    if (outcome.kind !== "applied") {
      throw new Error("a write met a conflict it did not answer");
    }
    refuseHeldAddress(input.itemId, outcome.fields);
    // every op already true, a resend's after its answer was let go: the item as it stands
    if (!outcome.changed) {
      return { item: liveRow(input.itemId, item) };
    }
    return land(input.itemId, outcome.fields, item.blocks);
  };

  const holding = (id: string): CellItem => {
    const item = items.get(id);
    if (item === undefined) {
      throw new NotFoundError();
    }
    return item;
  };

  const held = (id: string): HeldItem => {
    const item = holding(id);
    return { ...liveRow(id, item), blocks: [...item.blocks] };
  };

  const made = (id: string): void => {
    const item = items.get(id);
    if (item !== undefined) {
      throw new ConflictError({ data: { current: [{ itemId: id, kind: "item", seq: item.seq }] } });
    }
  };

  // a save of the address an item holds: that item as it stands
  const answerHeld = (id: string) => ({ created: false, item: liveRow(id, holding(id)) });

  // the folder a write files into, a live one the library holds; the fake files by id alone
  const folderIdOf = (target: FolderTarget): string | null | undefined => {
    if (target === undefined || target === null) {
      return target;
    }
    if (!("id" in target)) {
      throw new Error("the fake cell files by a folder's id, never its path");
    }
    const folder = folders.get(target.id);
    if (folder === undefined || folder.deletedAt !== null) {
      throw new NotFoundError();
    }
    return target.id;
  };

  // tags, folder, pin and title for each item, by the ops the cell's own organize lands
  // (`organizeItems` in `@repo/service`); an id naming no item refuses them all
  const organize = (input: OrganizeInput): LiveRow[] => {
    const folderId = folderIdOf(input.folder);
    const ids = [...new Set(input.ids)];
    if (ids.some((id) => !items.has(id))) {
      throw new NotFoundError();
    }
    const removed = new Set((input.removeTags ?? []).map(tagKey));
    return ids.map((itemId) => {
      const { fields } = holding(itemId);
      const ops: FieldOp[] = [];
      if (input.addTags !== undefined || input.removeTags !== undefined) {
        const kept = fields.tags.filter((tag) => !removed.has(tagKey(tag)));
        const keys = new Set(kept.map(tagKey));
        const added = (input.addTags ?? []).filter((tag) => !keys.has(tagKey(tag)));
        ops.push({ base: fields.tags, op: "tags", value: [...kept, ...new Set(added)] });
      }
      if (folderId !== undefined && folderId !== fields.folderId) {
        ops.push({ base: fields.folderId, field: "folderId", op: "set", value: folderId });
      }
      if (input.pinned !== undefined && input.pinned !== (fields.pinnedAt !== null)) {
        const pinnedAt = input.pinned ? NOW : null;
        ops.push({ base: fields.pinnedAt, field: "pinnedAt", op: "set", value: pinnedAt });
      }
      if (input.title !== undefined && input.title !== fields.title) {
        ops.push({ base: fields.title, field: "title", op: "set", value: input.title });
      }
      return write({ itemId, ops }).item;
    });
  };

  // the live sibling a folder would share a name with, which the cell answers a CONFLICT naming
  const namesakeOf = (op: FolderOp, folder: FolderRow | null): FolderRow | null => {
    const parentId = op.op === "create" || op.op === "move" ? op.parentId : folder?.parentId;
    const name = op.op === "create" || op.op === "rename" ? op.name : folder?.name;
    if (op.op === "delete" || name === undefined) {
      return null;
    }
    return (
      [...folders.values()].find(
        (sibling) =>
          sibling.id !== op.id &&
          sibling.deletedAt === null &&
          sibling.parentId === parentId &&
          titleKey(sibling.name) === titleKey(name),
      ) ?? null
    );
  };

  const storeFolder = (row: FolderRow, landed: Map<string, FolderRow>): void => {
    folders.set(row.id, row);
    landed.set(row.id, row);
  };

  const deleteUnder = (parentId: string, landed: Map<string, FolderRow>): void => {
    for (const folder of folders.values()) {
      if (folder.parentId === parentId && folder.deletedAt === null) {
        storeFolder({ ...folder, deletedAt: NOW, seq: head }, landed);
        deleteUnder(folder.id, landed);
      }
    }
  };

  const folderWrite = (ops: readonly FolderOp[]) => {
    const conflicts: ConflictCurrent[] = [];
    for (const op of ops) {
      const folder = folders.get(op.id) ?? null;
      const moved =
        (op.op === "create" && folder !== null) ||
        (op.op !== "create" && folder === null) ||
        (op.op === "rename" && folder?.name !== op.base) ||
        (op.op === "move" && folder?.parentId !== op.baseParentId);
      const namesake = namesakeOf(op, folder);
      if (moved) {
        conflicts.push({ current: folder, id: op.id, kind: "folder" });
      } else if (namesake !== null) {
        conflicts.push({ current: namesake, id: namesake.id, kind: "folder" });
      }
    }
    throwConflicts(conflicts);
    head += 1;
    const landed = new Map<string, FolderRow>();
    for (const op of ops) {
      const next = folderAfter(op, folders.get(op.id) ?? null, head);
      if (next !== null) {
        storeFolder(next, landed);
      }
      if (op.op === "delete") {
        deleteUnder(op.id, landed);
      }
    }
    return { folders: [...landed.values()], seq: head };
  };

  const landedSchema = z.object({ item: liveItemRowSchema });
  const savedSchema = z.object({ created: z.boolean() }).and(landedSchema);
  const foldersWrittenSchema = z.object({ folders: z.array(folderRowSchema), seq: z.number() });
  const organizedSchema = z.object({ items: z.array(itemSummarySchema) });
  const restoredSchema = z.object({
    addressHeld: z.array(z.string()),
    missing: z.array(z.string()),
    restored: z.array(z.string()),
  });
  const purgedSchema = z.object({ missing: z.array(z.string()), purged: z.array(z.string()) });
  const os = implement(v1Contract);

  const router = {
    account: {
      socketTicket: os.account.socketTicket.handler(() => ({
        expiresAt: NOW + 60_000,
        ticket: "a-ticket",
      })),
    },
    library: {
      folders: {
        write: os.library.folders.write.handler(({ input }) =>
          once(input.opId, foldersWrittenSchema, () => folderWrite(input.ops)),
        ),
      },
      items: {
        create: os.library.items.create.handler(({ input }) =>
          once(input.opId, landedSchema, () => {
            made(input.id);
            needsBlobs(shasIn(JSON.stringify(input.blocks)));
            return land(input.id, noteFields(input), input.blocks);
          }),
        ),
        createFile: os.library.items.createFile.handler(({ input }) =>
          once(input.opId, landedSchema, () => {
            made(input.id);
            needsBlobs([input.sha]);
            const mime = blobs.get(input.sha)?.mime ?? UNKNOWN_FILE_TYPE;
            return land(input.id, fileFields({ ...input, mime }), []);
          }),
        ),
        delete: os.library.items.delete.handler(({ input }) => {
          const deleted = input.ids.filter((id) => items.has(id));
          for (const id of deleted) {
            const item = holding(id);
            land(id, { ...item.fields, deletedAt: NOW }, item.blocks);
          }
          return { deleted, missing: input.ids.filter((id) => !deleted.includes(id)) };
        }),
        get: os.library.items.get.handler(({ input }) => held(input.id)),
        organize: os.library.items.organize.handler(({ input }) =>
          once(input.opId, organizedSchema, () => ({ items: organize(input).map(summaryOf) })),
        ),
        // emptying Deleted: an item there goes for good, and any other id is missing
        purge: os.library.items.purge.handler(({ input }) =>
          once(input.opId, purgedSchema, () => {
            const purged: string[] = [];
            const missing: string[] = [];
            for (const id of new Set(input.ids)) {
              const item = items.get(id);
              if (item === undefined || item.fields.deletedAt === null) {
                missing.push(id);
              } else {
                items.delete(id);
                purged.push(id);
              }
            }
            return { missing, purged };
          }),
        ),
        // a link's page read again: it waits once more; an item with no address has no page
        refresh: os.library.items.refresh.handler(({ input }) =>
          once(input.opId, landedSchema, () => {
            const { fields } = holding(input.id);
            if (fields.url === null) {
              throw new NotFoundError();
            }
            return write({
              itemId: input.id,
              ops: [
                { base: fields.fetchState, field: "fetchState", op: "set", value: "pending" },
                { base: fields.fetchError, field: "fetchError", op: "set", value: null },
              ],
            });
          }),
        ),
        restore: os.library.items.restore.handler(({ input }) =>
          once(input.opId, restoredSchema, () => {
            const known = input.ids.filter((id) => items.has(id));
            const addressHeld = known.filter((id) => {
              const address = holding(id).fields.url;
              const holder = address === null ? null : holderOf(address);
              return holder !== null && holder !== id;
            });
            const restored = known.filter((id) => !addressHeld.includes(id));
            for (const id of restored) {
              const item = holding(id);
              land(id, { ...item.fields, deletedAt: null }, item.blocks);
            }
            return {
              addressHeld,
              missing: input.ids.filter((id) => !known.includes(id)),
              restored,
            };
          }),
        ),
        row: os.library.items.row.handler(({ input }) => liveRow(input.id, holding(input.id))),
        save: os.library.items.save.handler(({ input }) =>
          once(input.opId, savedSchema, () => {
            needsBlobs(input.coverSha === null ? [] : [input.coverSha]);
            const holder = holderOf(input.url);
            if (holder !== null) {
              return answerHeld(holder);
            }
            made(input.id);
            return {
              created: true,
              ...land(input.id, pageFields(input, NOW), [
                ...noteBlocks(input.id, input.note),
                ...input.article.map((block): BodyBlock => ({ block, section: "article" })),
              ]),
            };
          }),
        ),
        saveLink: os.library.items.saveLink.handler(({ input }) =>
          once(input.opId, savedSchema, () => {
            const holder = holderOf(input.url);
            if (holder !== null) {
              return answerHeld(holder);
            }
            const folderId = folderIdOf(input.folder) ?? null;
            const id = input.id ?? mintId();
            made(id);
            return {
              created: true,
              ...land(
                id,
                stubFields({
                  folderId,
                  savedAt: input.savedAt ?? NOW,
                  tags: input.tags ?? [],
                  title: input.title,
                  url: input.url,
                }),
                noteBlocks(id, input.note),
              ),
            };
          }),
        ),
      },
      listing: {
        page: os.library.listing.page.handler(({ input }) =>
          listingPageOf(
            listing(),
            input,
            input.words === undefined ? null : searchHits(input.words, input.query.deleted),
          ),
        ),
        scopes: os.library.listing.scopes.handler(() => listing().scopes()),
        titles: os.library.listing.titles.handler(() => listing().titles()),
      },
      write: os.library.write.handler(({ input }) =>
        once(input.opId, landedSchema, () => write(input)),
      ),
    },
  };

  const handler = new RPCHandler(router, {
    // the Worker refuses a revoked credential before any procedure, in the procedure's protocol
    clientInterceptors: [
      async (options) => {
        if (signedOut) {
          throw new UnauthorizedError();
        }
        return await options.next();
      },
    ],
    errorStatusMap: V1_ERROR_STATUS_MAP,
  });

  const upload = async (request: Request, sha: string): Promise<Response> => {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (fileSha(bytes) !== sha) {
      return new Response(null, { status: 400 });
    }
    uploads.push(sha);
    blobs.set(sha, { bytes, mime: request.headers.get("content-type") ?? UNKNOWN_FILE_TYPE });
    return new Response(null, { status: 201 });
  };

  const download = (sha: string): Response => {
    const file = blobs.get(sha);
    return file === undefined
      ? new Response(null, { status: 404 })
      : new Response(file.bytes, { headers: { "content-type": file.mime } });
  };

  const serve = async (name: string, request: Request): Promise<Response> => {
    const path = request.url.slice(ORIGIN.length);
    if (path.startsWith(`${V1_BLOBS_PATH}/`)) {
      const sha = path.slice(V1_BLOBS_PATH.length + 1);
      return request.method === "PUT" ? await upload(request, sha) : download(sha);
    }
    calls.push(`${name} ${path.slice(V1_RPC_PATH.length + 1)}`);
    const { matched, response } = await handler.handle(request, { prefix: V1_RPC_PATH });
    return matched ? response : new Response(null, { status: 404 });
  };

  return {
    calls,
    device: (name) => {
      let offline = false;
      let lose = 0;
      const transport: V1Transport = {
        fetch: async (request) => {
          if (offline) {
            throw new TypeError("the network is down");
          }
          const response = await serve(name, request);
          if (lose > 0) {
            lose -= 1;
            await response.arrayBuffer();
            throw new TypeError("the answer was lost");
          }
          return response;
        },
        origin: ORIGIN,
      };
      const link = new RPCLink({
        fetch: async (url, init) => await transport.fetch(new Request(url, init)),
        origin: ORIGIN,
        url: V1_RPC_PATH,
      });
      return {
        client: createORPCClient<V1Client>(link),
        link,
        loseAnswers: (count) => {
          lose = count;
        },
        setOffline: (next) => {
          offline = next;
        },
        transport,
      };
    },
    held,
    item: (id) => items.get(id) ?? null,
    items: () => items,
    listed: (id) => listedItem(listingRow(id, holding(id))),
    seed: {
      folder: (name) => {
        const id = mintId();
        const last =
          [...folders.values()]
            .filter((folder) => folder.parentId === null && folder.deletedAt === null)
            .map((folder) => folder.sort)
            .toSorted(compareText)
            .at(-1) ?? null;
        folderWrite([{ id, name, op: "create", parentId: null, sort: ordBetween(last, null) }]);
        return id;
      },
      item: (fields = {}) => {
        const id = mintId();
        land(id, { ...blankItemFields(NOW), ...fields }, []);
        return id;
      },
    },
    signOut: () => {
      signedOut = true;
    },
    uploads,
  };
};
