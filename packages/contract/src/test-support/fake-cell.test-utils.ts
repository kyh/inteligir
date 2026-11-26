import { on } from "node:events";
import { createORPCClient } from "@orpc/client";
import type { ClientContext, ClientLink } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { implement, withEventMeta } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { V1_BLOBS_PATH } from "../library/library-blobs";
import { viewsWith, viewsWithout } from "../library/saved-views";
import type { SavedView } from "../library/saved-views";
import { deferred } from "../deferred";
import type { AgentEvent } from "../library/agent-events";
import type { bodyWriteSchema, listedItemSchema } from "../library/library-wire";
import {
  BODY_MAX_BYTES,
  bodyBytes,
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
import { canHoldChildren, isContainerKind, UNKNOWN_FILE_TYPE } from "../items/item-kind";
import type { ItemKind } from "../items/item-kind";
import { urlKey } from "../items/item-url";
import { canonicalJson, sameJson } from "../library/canonical-json";
import { NEW_LIST, renamedProperties } from "../library/list-settings";
import { itemFilesOf, lineOf, organized, parentRefusal } from "../library/cell-rules";
import type { OrganizeInput, ParentReader, ParentTarget } from "../library/cell-rules";
import { applyPropertyOps } from "../library/field-ops";
import { takesRead, withPage, withReading } from "../library/item-reading";
import type { ReadPage } from "../library/item-reading";
import type { PropertyOp } from "../library/field-ops";
import { compareText } from "../library/order-key";
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
import { mulberry32 } from "./seeded-random.test-utils";
import { z } from "zod";

import type { V1Transport } from "../rpc/call-outcome";

type LiveRow = z.infer<typeof liveItemRowSchema>;

type ListedItem = z.infer<typeof listedItemSchema>;

type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

type OpenRow = LiveRow & { readonly bodyVersion: number };

type HeldItem = OpenRow & { readonly blocks: BodyBlock[] };

const HEAD_POLL_MS = 1000;

type Changes = Awaited<ReturnType<V1Client["library"]["changes"]>>;

type BodyWrite = z.infer<typeof bodyWriteSchema>;

interface CellItem {
  readonly fields: LibraryItemFields;
  readonly blocks: readonly BodyBlock[];
  readonly bodyVersion: number;
  readonly seq: number;
  readonly updatedAt: number;
}

export interface FakeDevice {
  readonly transport: V1Transport;
  readonly link: ClientLink<ClientContext>;
  readonly client: V1Client;
  readonly setOffline: (offline: boolean) => void;
  readonly loseAnswers: (count: number) => void;
}

export interface FakeCell {
  readonly device: (name: string) => FakeDevice;
  readonly seed: {
    readonly item: (fields?: Partial<LibraryItemFields>, blocks?: readonly BodyBlock[]) => string;
    readonly folder: (name: string) => string;
  };
  readonly listed: (id: string) => ListedItem;
  readonly held: (id: string) => HeldItem;
  readonly item: (id: string) => CellItem | null;
  readonly items: () => ReadonlyMap<string, CellItem>;
  readonly calls: string[];
  readonly uploads: string[];
  readonly signOut: () => void;
  readonly threadEvent: (threadId: string, event: AgentEvent) => void;
}

const NOW = 1_700_000_100_000;
const ORIGIN = "https://cell.test";
const STORE_PATH = "/store";
const ID_SEED = 0x5e_ed;

const noteBlocks = (id: string, note: string | undefined) => {
  const blockId = `${id}-note`;

  return (
    note === undefined || note.trim() === ""
      ? []
      : [{ block: { children: [{ text: note }], id: blockId, type: "p" }, section: "note" }]
  ) satisfies BodyBlock[];
};

const derivedOf = (item: CellItem) => {
  const body = deriveBody(item.blocks);

  return { ...deriveItem(item.fields, body.digest), text: body.text };
};

const filesOf = (fields: LibraryItemFields, blocks: readonly BodyBlock[]) =>
  itemFilesOf(fields, deriveBody(blocks).digest.files);

const MEANING_HITS = 50;

export const createFakeCell = () => {
  let head = 0;
  let signedOut = false;
  let views: SavedView[] = [];
  let viewsSeq = 0;
  const items = new Map<string, CellItem>();
  const tombstones = new Map<string, number>();

  const blobs = new Map<
    string,
    { readonly bytes: Uint8Array<ArrayBuffer>; readonly mime: string }
  >();

  const sent = new Map<
    string,
    { readonly bytes: Uint8Array<ArrayBuffer>; readonly mime: string }
  >();

  const answers = new Map<string, unknown>();
  const calls: string[] = [];
  const uploads: string[] = [];
  const threads = new Map<string, ThreadEventRow[]>();
  const threadFed = new EventTarget();
  const fedSchema = z.object({ detail: threadEventRowSchema });

  const random = mulberry32(ID_SEED);
  let minted = 0;

  const mintId = () => {
    minted += 1;

    return uuidV7(
      NOW + minted,
      Uint8Array.from({ length: 16 }, () => Math.floor(random() * 256)),
    );
  };

  const liveRow = (id: string, item: CellItem) => {
    const { card } = derivedOf(item);

    return {
      card: answerCard(card),
      fields: item.fields,
      id,
      seq: item.seq,
      updatedAt: item.updatedAt,
    } satisfies LiveRow;
  };

  const listingRow = (id: string, item: CellItem) => {
    const { card, tags } = derivedOf(item);

    return itemListing(
      { card, fields: item.fields, id, seq: item.seq, updatedAt: item.updatedAt },
      [...new Set(tags.map(({ tag }) => tag))].toSorted(compareText),
    );
  };

  const listing = () => {
    const index = new LibraryIndex<ItemListing>();

    for (const [id, item] of items) {
      index.upsert(listingRow(id, item));
    }

    return index;
  };

  const searchHits = (words: string, deleted: boolean) => {
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
    } satisfies SearchHits;
  };

  const wordsOf = (item: CellItem) => {
    const { search, text } = derivedOf(item);
    const all = `${search.title} ${text}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];

    return new Set(all);
  };

  const nearest = (words: ReadonlySet<string>, except: string | null, limit: number) =>
    [...items]
      .flatMap(([id, item]) => {
        if (id === except || item.fields.deletedAt !== null || isContainerKind(item.fields.kind)) {
          return [];
        }

        const held = wordsOf(item);
        const shared = [...words].filter((word) => held.has(word)).length;

        return shared === 0 ? [] : [{ id, score: shared / (words.size + held.size - shared) }];
      })
      .toSorted((a, b) => b.score - a.score || compareText(a.id, b.id))
      .slice(0, limit)
      .map(({ id }) => id);

  const withMeaning = (hits: SearchHits, words: string) => {
    const rank = new Map(hits.rank);
    const asked = new Set(words.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu));

    for (const id of nearest(asked, null, MEANING_HITS)) {
      if (!rank.has(id)) {
        rank.set(id, rank.size);
      }
    }

    return { ...hits, rank } satisfies SearchHits;
  };

  const related = (id: string, limit: number) => {
    const own = items.get(id);

    return {
      items:
        own === undefined
          ? []
          : nearest(wordsOf(own), id, limit).flatMap((near) => {
              const held = items.get(near);

              return held === undefined ? [] : [listedItem(listingRow(near, held))];
            }),
    };
  };

  const needsBlobs = (shas: readonly string[]) => {
    const [first, ...rest] = [...new Set(shas)].filter((sha) => !blobs.has(sha)).toSorted();

    if (first !== undefined) {
      throw new BlobMissingError({ data: { shas: [first, ...rest] } });
    }
  };

  const land = (id: string, fields: LibraryItemFields, blocks: readonly BodyBlock[]) => {
    if (!libraryItemFieldsSchema.validate(fields)) {
      throw new PayloadTooLargeError();
    }

    const prior = items.get(id);
    const named = prior === undefined ? [] : filesOf(prior.fields, prior.blocks);
    needsBlobs(filesOf(fields, blocks).filter((sha) => !named.includes(sha)));
    head += 1;

    const bodyVersion =
      prior === undefined ? 1 : prior.bodyVersion + (prior.blocks === blocks ? 0 : 1);

    const item: CellItem = { blocks, bodyVersion, fields, seq: head, updatedAt: NOW + head };
    items.set(id, item);

    return { item: liveRow(id, item) };
  };

  const once = <T>(opId: string | undefined, schema: z.ZodType<T>, act: () => T) => {
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

  const holderOf = (url: string) => {
    const key = urlKey(url);

    for (const [id, item] of items) {
      const { deletedAt, url: address } = item.fields;

      if (key !== null && deletedAt === null && address !== null && urlKey(address) === key) {
        return id;
      }
    }

    return null;
  };

  const holding = (id: string) => {
    const item = items.get(id);

    if (item === undefined) {
      throw new NotFoundError();
    }

    return item;
  };

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

  const saveBody = (input: {
    readonly id: string;
    readonly baseVersion: number;
    readonly blocks: readonly BodyBlock[];
  }) => {
    const item = holding(input.id);

    if (item.fields.deletedAt !== null) {
      return { kind: "deleted" } satisfies BodyWrite;
    }

    if (bodyBytes(input.blocks) > BODY_MAX_BYTES) {
      return { kind: "full", maxBytes: BODY_MAX_BYTES } satisfies BodyWrite;
    }

    if (item.bodyVersion !== input.baseVersion) {
      return (
        sameBody(item.blocks, input.blocks)
          ? { kind: "saved", seq: item.seq, version: item.bodyVersion }
          : { kind: "stale", version: item.bodyVersion }
      ) satisfies BodyWrite;
    }

    land(input.id, item.fields, input.blocks);

    return { kind: "saved", seq: head, version: input.baseVersion + 1 } satisfies BodyWrite;
  };

  const openRow = (id: string) => {
    const item = holding(id);

    return { ...liveRow(id, item), bodyVersion: item.bodyVersion } satisfies OpenRow;
  };

  const held = (id: string) =>
    ({ ...openRow(id), blocks: [...holding(id).blocks] }) satisfies HeldItem;

  const made = (id: string) => {
    if (items.has(id) || tombstones.has(id)) {
      throw new ConflictError();
    }
  };

  const answerHeld = (id: string) => ({ created: false, item: liveRow(id, holding(id)) });

  const landRead = (id: string, item: CellItem, page: ReadPage, article: readonly BodyBlock[]) =>
    land(id, withPage(item.fields, page, NOW), [...item.blocks, ...article]);

  const parents: ParentReader = {
    item: (id) => items.get(id)?.fields ?? null,
  };

  const parentIdOf = (
    target: ParentTarget | undefined,
    children: readonly { readonly id: string; readonly kind: ItemKind }[],
  ) => {
    if (target === undefined || target === null) {
      return target;
    }

    if (!("id" in target)) {
      throw new Error("the fake cell files by a parent's id, never its path");
    }

    for (const child of children) {
      const refusal = parentRefusal(parents, child, target.id);

      if (refusal === "not-found") {
        throw new NotFoundError();
      }

      if (refusal === "conflict") {
        throw new ConflictError();
      }
    }

    return target.id;
  };

  const childrenOf = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const kind = items.get(id)?.fields.kind;

      return kind === undefined ? [] : [{ id, kind }];
    });

  const withContainersUnder = (ids: readonly string[]) => {
    const found = [...ids];

    for (const id of found) {
      for (const [childId, child] of items) {
        const { deletedAt, kind, parentId } = child.fields;

        if (
          parentId === id &&
          deletedAt === null &&
          isContainerKind(kind) &&
          !found.includes(childId)
        ) {
          found.push(childId);
        }
      }
    }

    return found;
  };

  const deletedAtOf = (id: string) => items.get(id)?.fields.deletedAt ?? 0;

  const setDeleted = (ids: readonly string[], deleted: boolean) => {
    const at = NOW + head + 1;
    const changed: string[] = [];
    const addressHeld: string[] = [];
    const unique = [...new Set(deleted ? withContainersUnder(ids) : ids)];
    const missing = unique.filter((id) => !items.has(id));
    const present = unique.filter((id) => items.has(id));

    const ordered = deleted
      ? present
      : present.toSorted((a, b) => deletedAtOf(b) - deletedAtOf(a) || compareText(a, b));

    for (const id of ordered) {
      const item = holding(id);

      if ((item.fields.deletedAt !== null) === deleted) {
        changed.push(id);
      } else if (!deleted && item.fields.url !== null && holderOf(item.fields.url) !== null) {
        addressHeld.push(id);
      } else {
        land(id, { ...item.fields, deletedAt: deleted ? at : null }, item.blocks);
        changed.push(id);
      }
    }

    return { addressHeld, changed, missing };
  };

  const organize = (input: OrganizeInput) => {
    const parentId = parentIdOf(input.parent, childrenOf(input.ids));

    const next = [...new Set(input.ids)].map((itemId) => {
      const fields = organized(holding(itemId).fields, input, parentId, NOW);

      if (!libraryItemFieldsSchema.validate(fields)) {
        throw new PayloadTooLargeError();
      }

      return { fields, itemId };
    });

    return next.map(({ fields, itemId }) => landFields(itemId, fields).item);
  };

  const sweepOrganize = (asked: readonly string[], verb: Omit<OrganizeInput, "ids">) => {
    const parentId = parentIdOf(verb.parent, []);
    const above = lineOf(parents, parentId ?? null);
    const ids = asked.filter((id) => !above.has(id));

    const refused = ids.filter((itemId) => {
      const { fields } = holding(itemId);
      const swept = organized(fields, { ...verb, ids: [] }, parentId, NOW);
      const fits = libraryItemFieldsSchema.validate(swept);
      landFields(
        itemId,
        fits ? swept : organized(fields, { ids: [], pinned: verb.pinned }, parentId, NOW),
      );

      return !fits;
    });

    return refused.toSorted();
  };

  const restoreSwept = (ids: readonly string[]) =>
    setDeleted(
      ids.filter((id) => holding(id).fields.deletedAt !== null),
      false,
    ).addressHeld.toSorted();

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

  const changes = (after: number | undefined) => {
    if (after === undefined || after === head) {
      return { head, moved: null } satisfies Changes;
    }

    if (after > head) {
      return { head, moved: { items: "all", threads: "all", tree: true } } satisfies Changes;
    }

    const stamped = [
      ...[...items].map(([id, { seq }]) => ({ id, seq })),
      ...[...tombstones].map(([id, seq]) => ({ id, seq })),
    ].filter(({ seq }) => seq > after);

    return {
      head,
      moved: {
        items: stamped,
        threads: [],
        tree:
          viewsSeq > after ||
          [...items.values()].some(
            ({ fields, seq }) => seq > after && canHoldChildren(fields.kind),
          ) ||
          [...tombstones.values()].some((seq) => seq > after),
      },
    } satisfies Changes;
  };

  const landedSchema = z.object({ item: liveItemRowSchema });
  const seqAnswerSchema = z.object({ seq: z.number() });
  const savedSchema = z.object({ created: z.boolean() }).and(landedSchema);
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
      heads: os.library.heads.handler(async function* heads({ signal }) {
        const stop = signal ?? new AbortController().signal;
        let told: number | null = null;

        while (!stop.aborted) {
          if (head !== told) {
            told = head;
            yield { head };
          }

          const waited = deferred();
          const timer = setTimeout(waited.resolve, HEAD_POLL_MS);
          stop.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              waited.resolve();
            },
            { once: true },
          );
          await waited.promise;
        }
      }),
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
      items: {
        create: os.library.items.create.handler(({ input }) =>
          once(input.opId, landedSchema, () => {
            made(input.id);
            parentIdOf(input.parentId === null ? null : { id: input.parentId }, [
              { id: input.id, kind: input.kind },
            ]);

            return land(
              input.id,
              {
                ...noteFields(input),
                kind: input.kind,
                list: input.kind === "list" ? NEW_LIST : null,
              },
              input.blocks,
            );
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
        related: os.library.items.related.handler(({ input }) => related(input.id, input.limit)),
        row: os.library.items.row.handler(({ input }) => openRow(input.id)),
        saveBody: os.library.items.saveBody.handler(({ input }) => saveBody(input)),
        setList: os.library.items.setList.handler(({ input }) =>
          once(input.opId, landedSchema, () => {
            const { fields } = holding(input.id);

            if (fields.kind !== "list" || fields.deletedAt !== null) {
              throw new ConflictError();
            }

            for (const [childId, child] of items) {
              const renamed = renamedProperties(child.fields.properties, input.renames);

              if (
                child.fields.parentId === input.id &&
                !sameJson(renamed, child.fields.properties)
              ) {
                landFields(childId, { ...child.fields, properties: renamed });
              }
            }

            return landFields(input.id, { ...fields, list: input.list });
          }),
        ),
        save: os.library.items.save.handler(({ input }) =>
          once(input.opId, savedSchema, () => {
            const article = input.article.map(
              (block) =>
                ({
                  block,
                  section: "article",
                }) satisfies BodyBlock,
            );

            const holder = holderOf(input.url);

            if (holder !== null) {
              const item = holding(holder);

              if (!takesRead(item.fields.reading, deriveBody(item.blocks).digest.article, input)) {
                return answerHeld(holder);
              }

              return { created: false, ...landRead(holder, item, input, article) };
            }

            made(input.id);

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

            const id = input.id ?? mintId();
            const parentId = parentIdOf(input.parent, [{ id, kind: "link" }]) ?? null;
            made(id);

            return {
              created: true,
              ...land(
                id,
                stubFields({
                  parentId,
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
        sweep: os.library.items.sweep.handler(({ input: { verb, ...swept } }) => {
          const ids = sweptIds(listing(), swept);

          switch (verb.kind) {
            case "organize": {
              return { items: ids.length, refused: sweepOrganize(ids, verb) };
            }

            case "delete": {
              setDeleted(ids, true);

              return { items: ids.length, refused: [] };
            }

            case "restore": {
              return { items: ids.length, refused: restoreSwept(ids) };
            }

            case "purge": {
              purge(ids);

              return { items: ids.length, refused: [] };
            }

            default: {
              throw new Error(`unexpected ${String(verb satisfies never)}`);
            }
          }
        }),
      },
      listing: {
        page: os.library.listing.page.handler(({ input }) =>
          listingPageOf(
            listing(),
            input,
            (words, deleted) =>
              input.meaning && !deleted
                ? withMeaning(searchHits(words, deleted), words)
                : searchHits(words, deleted),
            (row) => row,
          ),
        ),
        children: os.library.listing.children.handler(({ input }) =>
          listing().children(input.parentId),
        ),
        scopes: os.library.listing.scopes.handler(() => ({ ...listing().scopes(), views })),
        titles: os.library.listing.titles.handler(() => listing().titles()),
      },
      views: {
        remove: os.library.views.remove.handler(({ input }) =>
          once(input.opId, seqAnswerSchema, () => {
            if (views.some(({ id }) => id === input.id)) {
              head += 1;
              viewsSeq = head;
              views = viewsWithout(views, input.id);
            }

            return { seq: head };
          }),
        ),
        save: os.library.views.save.handler(({ input }) =>
          once(input.opId, seqAnswerSchema, () => {
            const next = viewsWith(views, input.view);

            if (next === null) {
              throw new PayloadTooLargeError();
            }

            head += 1;
            viewsSeq = head;
            views = next;

            return { seq: head };
          }),
        ),
      },
      write: os.library.write.handler(({ input }) =>
        once(input.opId, landedSchema, () => write(input)),
      ),
    },
  };

  const handler = new RPCHandler(router, {
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

  const store = async (request: Request, uploadId: string) => {
    const bytes = new Uint8Array(await request.arrayBuffer());
    sent.set(uploadId, { bytes, mime: request.headers.get("content-type") ?? UNKNOWN_FILE_TYPE });

    return new Response(null, { status: 200 });
  };

  const download = (sha: string) => {
    const file = blobs.get(sha);

    return file === undefined
      ? new Response(null, { status: 404 })
      : new Response(file.bytes, { headers: { "content-type": file.mime } });
  };

  const serve = async (name: string, request: Request) => {
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
        land(id, { ...blankItemFields(NOW), kind: "folder", title: name }, []);

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
  } satisfies FakeCell;
};
