// An account's library cell as a client's suites need it, in memory: `/v1/rpc` served by oRPC's
// own handler over the rows a client writes through and the reads its screens make (an item whole,
// a listing's pages, the rail's counts and every title, a thread's events as the suite feeds them),
// a store on its own origin that a file's upload is sent to, and `/v1/blobs/<sha>`, each device
// reaching it through a transport of its own whose network a suite can take down or whose next
// answers it can lose after the cell acted. It keeps the rules a client leans on: a property op
// lands only on the base it names (`@repo/contract/library/field-ops`) and answers CONFLICT where
// one moved, a verb of the cell's lands the fields the cell's own rules compute, an op id is
// answered once, a file must be uploaded before a write names it, every write takes the library's
// next sequence, and a read answers through the cell's own derivation and listing
// (`@repo/contract/library/derive-item`, `@repo/contract/library/library-index`). The cases in
// `./cell-conformance` hold it to the real cell, which runs them too. A suite seeds it without a
// call, and reads an item back as a listing or `items.get` answers it.

import { on } from "node:events";
import { createORPCClient } from "@orpc/client";
import type { ClientContext, ClientLink } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { implement, withEventMeta } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { V1_BLOBS_PATH } from "../library/library-blobs";
import type { AgentEvent } from "../library/agent-events";
import type { bodyWriteSchema, folderOpSchema, listedItemSchema } from "../library/library-wire";
import {
  BODY_MAX_BYTES,
  folderRowSchema,
  liveItemRowSchema,
  threadEventRowSchema,
} from "../library/library-wire";
import { organizedSchema } from "../rpc/library-contract";
import { v1Contract, V1_RPC_PATH } from "../rpc/v1-contract";
import type { V1Client } from "../rpc/v1-contract";
import {
  BlobMismatchError,
  BlobMissingError,
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  UnauthorizedError,
  V1_ERROR_STATUS_MAP,
} from "../rpc/v1-errors";
import { UNKNOWN_FILE_TYPE } from "../items/item-kind";
import { urlKey } from "../items/item-url";
import { canonicalJson, utf8ByteLength } from "../library/canonical-json";
import { folderOpLanding, folderOpRefusal, organized } from "../library/cell-rules";
import type { FolderReader, FolderTarget, OrganizeInput } from "../library/cell-rules";
import { applyPropertyOps } from "../library/field-ops";
import { takesRead, withPage, withReading } from "../library/item-reading";
import type { ReadPage } from "../library/item-reading";
import type { PropertyOp } from "../library/field-ops";
import { compareText, ordBetween } from "../library/order-key";
import { deriveBody, deriveItem, sameBody } from "../library/derive-item";
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
  itemSummary,
  LibraryIndex,
  listedItem,
  listingPageOf,
  sweptIds,
} from "../library/library-index";
import type { ItemListing, SearchHits } from "../library/library-index";
import { libraryItemFieldsSchema } from "../library/library-item";
import type { LibraryItemFields } from "../library/library-item";
import { uuidV7 } from "../library/uuid-v7";
import { mulberry32 } from "./seeded-random";
import { z } from "zod";

import type { V1Transport } from "../rpc/call-outcome";

type LiveRow = z.infer<typeof liveItemRowSchema>;
type ListedItem = z.infer<typeof listedItemSchema>;
type FolderOp = z.infer<typeof folderOpSchema>;
type FolderRow = z.infer<typeof folderRowSchema>;
type ThreadEventRow = z.infer<typeof threadEventRowSchema>;
type OpenRow = LiveRow & { readonly bodyVersion: number };
type HeldItem = OpenRow & { readonly blocks: BodyBlock[] };
type Changes = Awaited<ReturnType<V1Client["library"]["changes"]>>;
type BodyWrite = z.infer<typeof bodyWriteSchema>;

interface CellItem {
  readonly fields: LibraryItemFields;
  readonly blocks: readonly BodyBlock[];
  // 1 as the item is made, one more with each write of its blocks
  readonly bodyVersion: number;
  readonly seq: number;
  readonly updatedAt: number;
}

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

export interface FakeCell {
  readonly device: (name: string) => FakeDevice;
  // rows put in place without a call, each landing as a write lands, under a fresh id
  readonly seed: {
    // a note filed nowhere, unless `fields` says otherwise, holding `blocks`; never a live one at
    // an address a live item holds
    readonly item: (fields?: Partial<LibraryItemFields>, blocks?: readonly BodyBlock[]) => string;
    // a folder at the top, after the live ones there
    readonly folder: (name: string) => string;
  };
  // an item as `library.listing.page` lists it, and as `library.items.get` answers it
  readonly listed: (id: string) => ListedItem;
  readonly held: (id: string) => HeldItem;
  readonly item: (id: string) => CellItem | null;
  readonly items: () => ReadonlyMap<string, CellItem>;
  // each call, as `<device> <procedure>` (`library/write`), and each upload settled, by sha
  readonly calls: string[];
  readonly uploads: string[];
  // every call is refused as a revoked sign-in
  readonly signOut: () => void;
  // an event of the agent's in `threadId`, kept for every stream that opens after it and handed to
  // every stream open on the thread now
  readonly threadEvent: (threadId: string, event: AgentEvent) => void;
}

const NOW = 1_700_000_100_000;
const ORIGIN = "https://cell.test";
// where the cell's store takes an upload's bytes, on its own origin, as development's does
const STORE_PATH = "/store";
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

export const createFakeCell = (): FakeCell => {
  let head = 0;
  let signedOut = false;
  const items = new Map<string, CellItem>();
  // the ids of the items Deleted was emptied of, each at the sequence of the purge
  const tombstones = new Map<string, number>();
  const folders = new Map<string, FolderRow>();
  // each file's bytes, and its type as its upload named it
  const blobs = new Map<
    string,
    { readonly bytes: Uint8Array<ArrayBuffer>; readonly mime: string }
  >();
  // what each upload the store took was sent, by the sha its reserve named, until it settles
  const sent = new Map<
    string,
    { readonly bytes: Uint8Array<ArrayBuffer>; readonly mime: string }
  >();
  const answers = new Map<string, unknown>();
  const calls: string[] = [];
  const uploads: string[] = [];
  // each thread's events, as its record hook keeps them, and the live ones as they land
  const threads = new Map<string, ThreadEventRow[]>();
  const threadFed = new EventTarget();
  const fedSchema = z.object({ detail: threadEventRowSchema });

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
  const searchHits = (words: string, deleted: boolean): SearchHits => {
    const needle = words.toLowerCase();
    const lines = new Map<string, string>();
    for (const [id, item] of items) {
      const { search, text } = derivedOf(item);
      const line = [search.title, search.headings, search.meta, text]
        .flatMap((part) => part.split("\n"))
        .find((candidate) => candidate.toLowerCase().includes(needle));
      if ((item.fields.deletedAt !== null) === deleted && line !== undefined) {
        lines.set(id, line);
      }
    }
    return {
      passage: (id) => lines.get(id)?.trim() ?? null,
      rank: new Map([...lines.keys()].map((id, place) => [id, place])),
    };
  };

  // a landing that keeps the body hands its own blocks back, which leaves its version; fields past
  // their caps land nowhere, as the cell checks every landing's
  const land = (id: string, fields: LibraryItemFields, blocks: readonly BodyBlock[]) => {
    if (!libraryItemFieldsSchema.validate(fields)) {
      throw new PayloadTooLargeError();
    }
    head += 1;
    const prior = items.get(id);
    const bodyVersion =
      prior === undefined ? 1 : prior.bodyVersion + (prior.blocks === blocks ? 0 : 1);
    const item: CellItem = { blocks, bodyVersion, fields, seq: head, updatedAt: NOW + head };
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

  const holding = (id: string): CellItem => {
    const item = items.get(id);
    if (item === undefined) {
      throw new NotFoundError();
    }
    return item;
  };

  // an item's fields as a write leaves them; fields left as they were land nothing, and answer
  // the item as it stands
  const landFields = (id: string, fields: LibraryItemFields) => {
    const item = holding(id);
    return canonicalJson(item.fields) === canonicalJson(fields)
      ? { item: liveRow(id, item) }
      : land(id, fields, item.blocks);
  };

  const write = (input: { readonly itemId: string; readonly ops: readonly PropertyOp[] }) => {
    const outcome = applyPropertyOps(holding(input.itemId).fields, input.ops);
    if (outcome.kind === "conflict") {
      throw new ConflictError();
    }
    return landFields(input.itemId, outcome.fields);
  };

  // a note's body whole over the version its device read it at, answered as the cell's own
  // `writeBody` answers it: a save sent again, its first answer lost, finds its blocks there
  const saveBody = (input: {
    readonly id: string;
    readonly baseVersion: number;
    readonly blocks: readonly BodyBlock[];
  }): BodyWrite => {
    const item = holding(input.id);
    if (item.fields.deletedAt !== null) {
      return { kind: "deleted" };
    }
    if (utf8ByteLength(JSON.stringify(input.blocks)) > BODY_MAX_BYTES) {
      return { kind: "full", maxBytes: BODY_MAX_BYTES };
    }
    if (item.bodyVersion !== input.baseVersion) {
      return sameBody(item.blocks, input.blocks)
        ? { kind: "saved", seq: item.seq, version: item.bodyVersion }
        : { kind: "stale", version: item.bodyVersion };
    }
    needsBlobs(shasIn(JSON.stringify(input.blocks)));
    land(input.id, item.fields, input.blocks);
    return { kind: "saved", seq: head, version: input.baseVersion + 1 };
  };

  const openRow = (id: string): OpenRow => {
    const item = holding(id);
    return { ...liveRow(id, item), bodyVersion: item.bodyVersion };
  };

  const held = (id: string): HeldItem => ({ ...openRow(id), blocks: [...holding(id).blocks] });

  // an id is made once: an item holds it, or a purged one kept it
  const made = (id: string): void => {
    if (items.has(id) || tombstones.has(id)) {
      throw new ConflictError();
    }
  };

  // a save of the address an item holds: that item as it stands
  const answerHeld = (id: string) => ({ created: false, item: liveRow(id, holding(id)) });

  // a device's read on the item that holds its address: its fields once the page is read into
  // them, and its article after the item's own blocks
  const landRead = (id: string, item: CellItem, page: ReadPage, article: readonly BodyBlock[]) =>
    land(id, withPage(item.fields, page, NOW), [...item.blocks, ...article]);

  // the folder a write files into, a live one the library holds; the fake files by id alone
  const folderIdOf = (target: FolderTarget | undefined): string | null | undefined => {
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

  // To Deleted, or back: an item already where it is asked to be counts as changed and lands
  // nothing, an id naming no item is missing, and an item whose address another live item holds
  // now stays in Deleted
  const setDeleted = (ids: readonly string[], deleted: boolean) => {
    const changed: string[] = [];
    const missing: string[] = [];
    const addressHeld: string[] = [];
    for (const id of new Set(ids)) {
      const item = items.get(id);
      if (item === undefined) {
        missing.push(id);
      } else if ((item.fields.deletedAt !== null) === deleted) {
        changed.push(id);
      } else if (!deleted && item.fields.url !== null && holderOf(item.fields.url) !== null) {
        addressHeld.push(id);
      } else {
        land(id, { ...item.fields, deletedAt: deleted ? NOW : null }, item.blocks);
        changed.push(id);
      }
    }
    return { addressHeld, changed, missing };
  };

  // tags, folder, pin and title for each item, as the cell's own organize leaves them
  // (`organizeItems` in `@repo/service`); an id naming no item refuses them all
  const organize = (input: OrganizeInput): LiveRow[] => {
    const folderId = folderIdOf(input.folder);
    const ids = [...new Set(input.ids)];
    if (ids.some((id) => !items.has(id))) {
      throw new NotFoundError();
    }
    return ids.map(
      (itemId) => landFields(itemId, organized(holding(itemId).fields, input, folderId, NOW)).item,
    );
  };

  // a sweep's organize, as the cell's own lands one: every item to its folder and pin, and its
  // change of tags but where that would carry its fields past their caps, which answers it
  const sweepOrganize = (ids: readonly string[], verb: Omit<OrganizeInput, "ids">): string[] => {
    const folderId = folderIdOf(verb.folder);
    const refused = ids.filter((itemId) => {
      const { fields } = holding(itemId);
      const swept = organized(fields, { ...verb, ids: [] }, folderId, NOW);
      const fits = libraryItemFieldsSchema.validate(swept);
      landFields(
        itemId,
        fits ? swept : organized(fields, { ids: [], pinned: verb.pinned }, folderId, NOW),
      );
      return !fits;
    });
    return refused.toSorted();
  };

  // emptying Deleted: an item there goes for good, its id kept at the one sequence the purge
  // takes, and any other id is missing
  const purge = (ids: readonly string[]) => {
    const unique = [...new Set(ids)];
    const purged = unique.filter((id) => {
      const deletedAt = items.get(id)?.fields.deletedAt;
      return deletedAt !== undefined && deletedAt !== null;
    });
    const missing = unique.filter((id) => !purged.includes(id));
    if (purged.length > 0) {
      head += 1;
    }
    for (const id of purged) {
      items.delete(id);
      tombstones.set(id, head);
    }
    return { missing, purged };
  };

  // every op against the tree the ones before it left, as the cell lands them, and none if any
  // refuses
  const folderWrite = (ops: readonly FolderOp[]) => {
    const draft = new Map(folders);
    const reader: FolderReader = {
      children: (parentId) =>
        [...draft.values()].filter(
          (folder) => folder.parentId === parentId && folder.deletedAt === null,
        ),
      folder: (id) => draft.get(id) ?? null,
    };
    const landed = new Map<string, FolderRow>();
    for (const op of ops) {
      const refusal = folderOpRefusal(reader, op);
      if (refusal !== null) {
        throw refusal === "conflict" ? new ConflictError() : new NotFoundError();
      }
      for (const row of folderOpLanding(reader, op, NOW)) {
        const folder = { ...row, seq: head + 1 };
        draft.set(folder.id, folder);
        landed.set(folder.id, folder);
      }
    }
    head += 1;
    for (const folder of landed.values()) {
      folders.set(folder.id, folder);
    }
    return { folders: [...landed.values()], seq: head };
  };

  // what moved after `after`: each item stamped past it, a purged one too, and whether a folder
  // was; everything past a head the cell never reached. The fake holds no thread
  const changes = (after: number | undefined): Changes => {
    if (after === undefined || after === head) {
      return { head, moved: null };
    }
    if (after > head) {
      return { head, moved: { folders: true, items: "all", threads: "all" } };
    }
    const stamped = [
      ...[...items].map(([id, { seq }]) => ({ id, seq })),
      ...[...tombstones].map(([id, seq]) => ({ id, seq })),
    ].filter(({ seq }) => seq > after);
    return {
      head,
      moved: {
        folders: [...folders.values()].some(({ seq }) => seq > after),
        items: stamped,
        threads: [],
      },
    };
  };

  const landedSchema = z.object({ item: liveItemRowSchema });
  const savedSchema = z.object({ created: z.boolean() }).and(landedSchema);
  const foldersWrittenSchema = z.object({ folders: z.array(folderRowSchema), seq: z.number() });
  const deletedSchema = z.object({ deleted: z.array(z.string()), missing: z.array(z.string()) });
  const restoredSchema = z.object({
    addressHeld: z.array(z.string()),
    missing: z.array(z.string()),
    restored: z.array(z.string()),
  });
  const purgedSchema = z.object({ missing: z.array(z.string()), purged: z.array(z.string()) });
  const os = implement(v1Contract);

  const router = {
    library: {
      agent: {
        events: os.library.agent.events.handler(async function* events({
          input,
          lastEventId,
          signal,
        }) {
          // heard from before the kept events are read, so no event falls between the two
          const fed = on(threadFed, input.threadId, { signal });
          const kept = threads.get(input.threadId) ?? [];
          for (const row of kept.slice(
            kept.findIndex(({ eventId }) => eventId === lastEventId) + 1,
          )) {
            yield withEventMeta({ kind: "event" as const, row }, { id: row.eventId });
          }
          yield { kind: "caughtUp" as const };
          try {
            for await (const [landed] of fed) {
              const { detail: row } = fedSchema.parse(landed);
              yield withEventMeta({ kind: "event" as const, row }, { id: row.eventId });
            }
          } catch (error) {
            if (signal?.aborted !== true) {
              throw error;
            }
          }
        }),
      },
      changes: os.library.changes.handler(({ input }) => changes(input.after)),
      files: {
        reserve: os.library.files.reserve.handler(({ input }) =>
          blobs.has(input.sha)
            ? { kind: "held" as const }
            : {
                headers: { "content-type": input.mime },
                kind: "upload" as const,
                uploadId: input.sha,
                url: `${STORE_PATH}/${input.sha}`,
              },
        ),
        settle: os.library.files.settle.handler(({ input }) => {
          if (blobs.has(input.sha)) {
            return { kind: "held" as const };
          }
          const upload = sent.get(input.uploadId);
          if (upload === undefined) {
            throw new NotFoundError();
          }
          sent.delete(input.uploadId);
          if (fileSha(upload.bytes) !== input.sha) {
            throw new BlobMismatchError();
          }
          uploads.push(input.sha);
          blobs.set(input.sha, upload);
          return { kind: "kept" as const };
        }),
      },
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
        delete: os.library.items.delete.handler(({ input }) =>
          once(input.opId, deletedSchema, () => {
            const { changed, missing } = setDeleted(input.ids, true);
            return { deleted: changed, missing };
          }),
        ),
        get: os.library.items.get.handler(({ input }) => held(input.id)),
        organize: os.library.items.organize.handler(({ input }) =>
          once(input.opId, organizedSchema, () => ({
            items: organize(input).map(({ id }) => itemSummary(listingRow(id, holding(id)))),
          })),
        ),
        purge: os.library.items.purge.handler(({ input }) =>
          once(input.opId, purgedSchema, () => purge(input.ids)),
        ),
        // a link's page read again: it waits once more; an item with no address has no page
        refresh: os.library.items.refresh.handler(({ input }) =>
          once(input.opId, landedSchema, () => {
            const { fields } = holding(input.id);
            if (fields.url === null) {
              throw new NotFoundError();
            }
            return landFields(input.id, withReading(fields, { kind: "asked" }));
          }),
        ),
        restore: os.library.items.restore.handler(({ input }) =>
          once(input.opId, restoredSchema, () => {
            const { addressHeld, changed, missing } = setDeleted(input.ids, false);
            return { addressHeld, missing, restored: changed };
          }),
        ),
        row: os.library.items.row.handler(({ input }) => openRow(input.id)),
        saveBody: os.library.items.saveBody.handler(({ input }) => saveBody(input)),
        save: os.library.items.save.handler(({ input }) =>
          once(input.opId, savedSchema, () => {
            // checked only where the save lands, as the cell checks a landing's files: a held item
            // answered as it stands names no new one
            const cover = input.coverSha === null ? [] : [input.coverSha];
            const article = input.article.map((block): BodyBlock => ({
              block,
              section: "article",
            }));
            const holder = holderOf(input.url);
            if (holder !== null) {
              const item = holding(holder);
              if (!takesRead(item.fields.reading, deriveBody(item.blocks).digest.article, input)) {
                return answerHeld(holder);
              }
              needsBlobs(cover);
              return { created: false, ...landRead(holder, item, input, article) };
            }
            made(input.id);
            needsBlobs(cover);
            return {
              created: true,
              ...land(input.id, pageFields(input, NOW), [
                ...noteBlocks(input.id, input.note),
                ...article,
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
        // the scope's items, each by its verb's rule, landed as it is asked: a tag change's lots
        // are the service's suites' to hold
        sweep: os.library.items.sweep.handler(({ input: { verb, ...swept } }) => {
          const ids = sweptIds(listing(), swept);
          switch (verb.kind) {
            case "organize": {
              return { items: ids.length, refused: sweepOrganize(ids, verb) };
            }
            case "delete":
            case "restore": {
              const { addressHeld } = setDeleted(ids, verb.kind === "delete");
              return { items: ids.length, refused: addressHeld };
            }
            case "purge": {
              purge(ids);
              return { items: ids.length, refused: [] };
            }
            // no default
          }
        }),
      },
      listing: {
        page: os.library.listing.page.handler(({ input }) =>
          listingPageOf(listing(), input, searchHits, (row) => row),
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

  const store = async (request: Request, uploadId: string): Promise<Response> => {
    const bytes = new Uint8Array(await request.arrayBuffer());
    sent.set(uploadId, { bytes, mime: request.headers.get("content-type") ?? UNKNOWN_FILE_TYPE });
    return new Response(null, { status: 200 });
  };

  const download = (sha: string): Response => {
    const file = blobs.get(sha);
    return file === undefined
      ? new Response(null, { status: 404 })
      : new Response(file.bytes, { headers: { "content-type": file.mime } });
  };

  // by path alone, whatever origin a host's transport names
  const serve = async (name: string, request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path.startsWith(`${V1_BLOBS_PATH}/`)) {
      return download(path.slice(V1_BLOBS_PATH.length + 1));
    }
    if (path.startsWith(`${STORE_PATH}/`) && request.method === "PUT") {
      return await store(request, path.slice(STORE_PATH.length + 1));
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
      item: (fields = {}, blocks = []) => {
        const seeded = { ...blankItemFields(NOW), ...fields };
        if (seeded.deletedAt === null && seeded.url !== null && holderOf(seeded.url) !== null) {
          throw new Error(`a live item holds ${seeded.url} already`);
        }
        const id = mintId();
        land(id, seeded, blocks);
        return id;
      },
    },
    signOut: () => {
      signedOut = true;
    },
    threadEvent: (threadId, event) => {
      const kept = threads.get(threadId) ?? [];
      const row: ThreadEventRow = {
        at: NOW + kept.length,
        event,
        eventId: `1:${String(kept.length)}:0`,
        threadId,
        type: event.type,
      };
      threads.set(threadId, [...kept, row]);
      threadFed.dispatchEvent(new CustomEvent(threadId, { detail: row }));
    },
    uploads,
  };
};
