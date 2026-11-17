// Landing items inside a write's transaction: every rule a write meets (its fields within their
// caps, its body within a body's, one live item per url, only files the library holds, new items
// only within the library's room), then its rows, stamped with the write's one sequence number,
// and its turn's change set told when the built-in agent wrote it (`./library-change-sets`). An
// existing item's change writes only what changed: the body and its links when the write brings
// one, the tags and the search row when the body or the fields moved, the item's files when it
// names others. Items a write makes land together, a statement a table, so an import's batch is a
// handful of statements.

import { urlKey } from "@repo/contract/items/item-url";
import { canonicalJson } from "@repo/contract/library/canonical-json";
import { deriveBody, deriveItem } from "@repo/contract/library/derive-item";
import type {
  BodyBlock,
  BodyDigest,
  DerivedBody,
  DerivedItem,
  ItemCard,
} from "@repo/contract/library/derive-item";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { BODY_MAX_BYTES } from "@repo/contract/library/library-wire";
import { item, itemBody, itemLink, itemSearch, itemTag, purgedItem } from "@repo/db/library-schema";
import { and, eq, isNull, ne } from "drizzle-orm";

import { itemFilesOf, missingFiles, nameItemFiles, nameNewItemFiles } from "../files/file-names";
import { recordBody, recordLanding } from "./library-change-sets";
import { holdRoomFor } from "./library-quota";
import { refuse } from "./library-refusal";
import type { LibraryRefusal, LibraryResult } from "./library-refusal";
import {
  bodyRowOf,
  itemRowOf,
  linkRowsOf,
  readBodyFacts,
  searchRowOf,
  tagRowsOf,
} from "./library-rows";
import type { StoredItem } from "./library-rows";
import type { WriteScope } from "./library-store";
import { anyOf, chunksOf } from "./set-sql";

// an item as a write answers it
export interface LiveItemRow {
  readonly card: ItemCard;
  readonly fields: LibraryItemFields;
  readonly id: string;
  readonly seq: number;
  readonly updatedAt: number;
}

// an existing item's change: `body` the blocks it holds once the write lands, null to keep the
// body as it stands
export interface Landing {
  readonly itemId: string;
  readonly before: StoredItem;
  readonly fields: LibraryItemFields;
  readonly body: readonly BodyBlock[] | null;
}

// an item the write makes, with its body in reading order
export interface NewItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly blocks: readonly BodyBlock[];
}

// a body as a write leaves it: its row at its version, and what derives from its blocks
interface WrittenBody {
  readonly row: typeof itemBody.$inferInsert;
  readonly derived: DerivedBody;
}

// the body a change leaves: its digest and version, what it writes, null when it stays, and the
// files the body it replaces names
interface LandedBody {
  readonly digest: BodyDigest;
  readonly version: number;
  readonly written: WrittenBody | null;
  readonly priorFiles: readonly string[];
}

const itemIs = (accountId: string, itemId: string) =>
  and(eq(item.accountId, accountId), eq(item.id, itemId));

const sameShas = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((sha) => right.has(sha));
};

// blocks at a version, null past what a body holds
const bodyAt = (
  accountId: string,
  itemId: string,
  blocks: readonly BodyBlock[],
  version: number,
): WrittenBody | null => {
  const derived = deriveBody(blocks);
  const row = bodyRowOf(accountId, itemId, { blocks, digest: derived.digest, version });
  return row.bytes > BODY_MAX_BYTES ? null : { derived, row };
};

// the body a change leaves
const landedBody = async (scope: WriteScope, landing: Landing): Promise<LandedBody> => {
  const { body, itemId } = landing;
  const held = await readBodyFacts(scope.tx, scope.accountId, itemId);
  if (held === null) {
    throw new Error(`the item ${itemId} has no body row`);
  }
  const priorFiles = held.digest.files;
  if (body === null) {
    return { digest: held.digest, priorFiles, version: held.version, written: null };
  }
  const version = held.version + 1;
  const written = bodyAt(scope.accountId, itemId, body, version) ?? refuse({ kind: "too-large" });
  return { digest: written.derived.digest, priorFiles, version, written };
};

const urlHeldByAnother = async (
  scope: WriteScope,
  key: string,
  itemId: string,
): Promise<boolean> => {
  const held = await scope.tx
    .select({ id: item.id })
    .from(item)
    .where(
      and(
        eq(item.accountId, scope.accountId),
        eq(item.urlKey, key),
        isNull(item.deletedAt),
        ne(item.id, itemId),
      ),
    )
    .limit(1);
  return held.length > 0;
};

// every rule a change meets, before anything is written: a refusal leaves nothing to roll back
const checkLanding = async (scope: WriteScope, landing: Landing) => {
  const { before, fields, itemId } = landing;
  if (!libraryItemFieldsSchema.validate(fields)) {
    refuse({ kind: "too-large" });
  }
  const landed = await landedBody(scope, landing);
  const derived = deriveItem(fields, landed.digest);
  if (
    derived.urlKey !== null &&
    fields.deletedAt === null &&
    (await urlHeldByAnother(scope, derived.urlKey, itemId))
  ) {
    refuse({ kind: "url-held" });
  }
  const priorFiles = itemFilesOf(before.fields, landed.priorFiles);
  const files = itemFilesOf(fields, landed.digest.files);
  const missing = await missingFiles(
    scope.tx,
    scope.accountId,
    files.filter((sha) => !priorFiles.includes(sha)),
  );
  if (missing.length > 0) {
    refuse({ kind: "blob-missing", shas: missing });
  }
  return { derived, files, landed, priorFiles };
};

// a body's rows in place of the ones it held: the body at its version, and the links it holds
const replaceBody = async (
  scope: WriteScope,
  itemId: string,
  { derived, row }: WrittenBody,
): Promise<void> => {
  const { accountId, tx } = scope;
  await tx
    .update(itemBody)
    .set(row)
    .where(and(eq(itemBody.accountId, accountId), eq(itemBody.itemId, itemId)));
  await tx
    .delete(itemLink)
    .where(and(eq(itemLink.accountId, accountId), eq(itemLink.sourceId, itemId)));
  const links = linkRowsOf(accountId, itemId, derived.links);
  if (links.length > 0) {
    await tx.insert(itemLink).values(links);
  }
};

// the body's text as the search row holds it, for a landing of the fields alone
const heldText = async (scope: WriteScope, itemId: string): Promise<string> => {
  const [row] = await scope.tx
    .select({ text: itemSearch.text })
    .from(itemSearch)
    .where(and(eq(itemSearch.accountId, scope.accountId), eq(itemSearch.itemId, itemId)));
  return row?.text ?? "";
};

// what the item's fields and body give search and the rail: its tags and its search row
const replaceDerived = async (
  scope: WriteScope,
  itemId: string,
  derived: DerivedItem,
  text: string,
): Promise<void> => {
  const { accountId, tx } = scope;
  await tx.delete(itemTag).where(and(eq(itemTag.accountId, accountId), eq(itemTag.itemId, itemId)));
  const tags = tagRowsOf(accountId, itemId, derived.tags);
  if (tags.length > 0) {
    await tx.insert(itemTag).values(tags).onConflictDoNothing();
  }
  const search = searchRowOf(accountId, itemId, { ...derived.search, body: text });
  await tx
    .insert(itemSearch)
    .values(search)
    .onConflictDoUpdate({
      set: { text: search.text, vec: search.vec },
      target: [itemSearch.accountId, itemSearch.itemId],
    });
};

// an existing item as its change lands; refuses a change no rule admits, before anything is written
export const landItem = async (scope: WriteScope, landing: Landing): Promise<LiveItemRow> => {
  const { accountId, now, tx } = scope;
  const { before, fields, itemId } = landing;
  const { derived, files, landed, priorFiles } = await checkLanding(scope, landing);
  const setId = await scope.set();
  const seq = await scope.seq();
  const { written } = landed;
  if (setId !== null && written !== null) {
    await recordBody(scope, setId, { itemId, made: false, versionAfter: landed.version });
  }
  const row = itemRowOf(accountId, {
    card: derived.card,
    fields,
    id: itemId,
    seq,
    updatedAt: now,
    urlKey: derived.urlKey,
  });
  await tx.update(item).set(row).where(itemIs(accountId, itemId));
  if (written !== null) {
    await replaceBody(scope, itemId, written);
  }
  if (written !== null || canonicalJson(before.fields) !== canonicalJson(fields)) {
    const text = written === null ? await heldText(scope, itemId) : written.derived.text;
    await replaceDerived(scope, itemId, derived, text);
  }
  if (!sameShas(priorFiles, files)) {
    await nameItemFiles(tx, accountId, itemId, files, now);
  }
  if (setId !== null) {
    await recordLanding(scope, setId, {
      after: fields,
      before: before.fields,
      bodyFiles: written === null ? [] : landed.priorFiles,
      itemId,
    });
  }
  return { card: derived.card, fields, id: itemId, seq, updatedAt: now };
};

const liveKeyOf = ({ deletedAt, url }: LibraryItemFields): string | null =>
  deletedAt !== null || url === null ? null : urlKey(url);

interface HeldKeys {
  readonly ids: ReadonlySet<string>;
  readonly urlKeys: ReadonlySet<string>;
}

// what the library holds that a made item could meet: ids made already, live or purged, and the
// live items' url keys
const heldKeys = async (scope: WriteScope, made: readonly NewItem[]): Promise<HeldKeys> => {
  const { accountId, tx } = scope;
  const ids = made.map(({ id }) => id);
  const keys = made.flatMap(({ fields }) => liveKeyOf(fields) ?? []);
  const [items, purged, urls] = await Promise.all([
    tx
      .select({ id: item.id })
      .from(item)
      .where(and(eq(item.accountId, accountId), anyOf(item.id, ids))),
    tx
      .select({ id: purgedItem.id })
      .from(purgedItem)
      .where(and(eq(purgedItem.accountId, accountId), anyOf(purgedItem.id, ids))),
    keys.length === 0
      ? []
      : tx
          .select({ urlKey: item.urlKey })
          .from(item)
          .where(
            and(eq(item.accountId, accountId), isNull(item.deletedAt), anyOf(item.urlKey, keys)),
          ),
  ]);
  return {
    ids: new Set([...items, ...purged].map((row) => row.id)),
    urlKeys: new Set(urls.flatMap((row) => row.urlKey ?? [])),
  };
};

// a made item that met every rule its own row answers, before the files it names are asked after
interface Candidate {
  readonly made: NewItem;
  readonly body: WrittenBody;
  readonly derived: DerivedItem;
  readonly files: readonly string[];
}

const refused = (refusal: LibraryRefusal): LibraryResult<never> => ({ ok: false, refusal });

const candidateOf = (
  accountId: string,
  made: NewItem,
  held: HeldKeys,
): LibraryResult<Candidate> => {
  if (held.ids.has(made.id)) {
    return refused({ kind: "conflict" });
  }
  if (!libraryItemFieldsSchema.validate(made.fields)) {
    return refused({ kind: "too-large" });
  }
  const body = bodyAt(accountId, made.id, made.blocks, 1);
  if (body === null) {
    return refused({ kind: "too-large" });
  }
  const key = liveKeyOf(made.fields);
  if (key !== null && held.urlKeys.has(key)) {
    return refused({ kind: "url-held" });
  }
  const derived = deriveItem(made.fields, body.derived.digest);
  const files = itemFilesOf(made.fields, body.derived.digest.files);
  return { ok: true, value: { body, derived, files, made } };
};

// each candidate refused by a file the library lacks, or by an id or a url an earlier one claimed
const claimed = (
  checked: readonly LibraryResult<Candidate>[],
  missing: ReadonlySet<string>,
): LibraryResult<Candidate>[] => {
  const ids = new Set<string>();
  const urls = new Set<string>();
  return checked.map((outcome) => {
    if (!outcome.ok) {
      return outcome;
    }
    const { files, made } = outcome.value;
    const absent = files.filter((sha) => missing.has(sha)).toSorted();
    if (absent.length > 0) {
      return refused({ kind: "blob-missing", shas: absent });
    }
    if (ids.has(made.id)) {
      return refused({ kind: "conflict" });
    }
    const key = liveKeyOf(made.fields);
    if (key !== null && urls.has(key)) {
      return refused({ kind: "url-held" });
    }
    ids.add(made.id);
    if (key !== null) {
      urls.add(key);
    }
    return outcome;
  });
};

// each made item's rows, a statement a table, and the turn's set told of each; the sequence they
// took
const insertMade = async (scope: WriteScope, landed: readonly Candidate[]): Promise<number> => {
  const { accountId, now, tx } = scope;
  await holdRoomFor(
    scope,
    landed.reduce((sum, { body }) => sum + body.row.bytes, 0),
  );
  const setId = await scope.set();
  const seq = await scope.seq();
  const rows = landed.map(({ body, derived, made }) => ({
    body: body.row,
    item: itemRowOf(accountId, {
      card: derived.card,
      fields: made.fields,
      id: made.id,
      seq,
      updatedAt: now,
      urlKey: derived.urlKey,
    }),
    links: linkRowsOf(accountId, made.id, body.derived.links),
    search: searchRowOf(accountId, made.id, { ...derived.search, body: body.derived.text }),
    tags: tagRowsOf(accountId, made.id, derived.tags),
  }));
  for (const chunk of chunksOf(rows, 100)) {
    await tx.insert(item).values(chunk.map((row) => row.item));
    await tx.insert(itemBody).values(chunk.map((row) => row.body));
    await tx.insert(itemSearch).values(chunk.map((row) => row.search));
  }
  for (const chunk of chunksOf(
    rows.flatMap((row) => row.tags),
    1000,
  )) {
    await tx.insert(itemTag).values(chunk).onConflictDoNothing();
  }
  for (const chunk of chunksOf(
    rows.flatMap((row) => row.links),
    1000,
  )) {
    await tx.insert(itemLink).values(chunk);
  }
  await nameNewItemFiles(
    tx,
    accountId,
    landed.map(({ files, made }) => ({ itemId: made.id, shas: files })),
    now,
  );
  if (setId !== null) {
    for (const { body, made } of landed) {
      await recordBody(scope, setId, {
        itemId: made.id,
        made: true,
        versionAfter: body.row.version,
      });
      await recordLanding(scope, setId, {
        after: made.fields,
        before: null,
        bodyFiles: [],
        itemId: made.id,
      });
    }
  }
  return seq;
};

// Items the write makes, each landed or refused by the first rule it fails, in order: an id the
// library made already, or an earlier one of these claims, is a conflict, and a url a live item or
// an earlier one of these holds is held. Room is the whole batch's: past it the write is refused
export const landNewItems = async (
  scope: WriteScope,
  made: readonly NewItem[],
): Promise<LibraryResult<LiveItemRow>[]> => {
  const { accountId, now, tx } = scope;
  if (made.length === 0) {
    return [];
  }
  const held = await heldKeys(scope, made);
  const checked = made.map((each) => candidateOf(accountId, each, held));
  const named = checked.flatMap((outcome) => (outcome.ok ? outcome.value.files : []));
  const outcomes = claimed(checked, new Set(await missingFiles(tx, accountId, named)));
  const landed = outcomes.flatMap((outcome) => (outcome.ok ? [outcome.value] : []));
  const seq = landed.length === 0 ? 0 : await insertMade(scope, landed);
  return outcomes.map((outcome) =>
    outcome.ok
      ? {
          ok: true,
          value: {
            card: outcome.value.derived.card,
            fields: outcome.value.made.fields,
            id: outcome.value.made.id,
            seq,
            updatedAt: now,
          },
        }
      : outcome,
  );
};
