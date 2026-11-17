// Landing one item's change inside a write's transaction: every rule a write meets (its fields
// within their caps, its body within a body's, one live item per url, only files the library
// holds), then its rows, stamped with the write's one sequence number. Only what changed is
// written: the body and its links when the write brings one (`landBody`), the tags and the search
// row when the body or the fields moved, the item's files when it names others.

import { canonicalJson } from "@repo/contract/library/canonical-json";
import { deriveBody, deriveItem } from "@repo/contract/library/derive-item";
import type {
  BodyBlock,
  BodyDigest,
  DerivedBody,
  ItemCard,
} from "@repo/contract/library/derive-item";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { BODY_MAX_BYTES } from "@repo/contract/library/library-wire";
import { item, itemBody, itemLink, itemSearch, itemTag } from "@repo/db/library-schema";
import { and, eq, isNull, ne } from "drizzle-orm";

import { itemFilesOf, missingFiles, nameItemFiles } from "../files/file-names";
import { refuse } from "./library-refusal";
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

// an item as a write answers it
export interface LiveItemRow {
  readonly card: ItemCard;
  readonly fields: LibraryItemFields;
  readonly id: string;
  readonly seq: number;
  readonly updatedAt: number;
}

// `body`: the blocks the item holds once the write lands, which an item the write makes always
// brings; null keeps the body as it stands
export type Landing =
  | {
      readonly itemId: string;
      readonly before: null;
      readonly fields: LibraryItemFields;
      readonly body: readonly BodyBlock[];
    }
  | {
      readonly itemId: string;
      readonly before: StoredItem;
      readonly fields: LibraryItemFields;
      readonly body: readonly BodyBlock[] | null;
    };

// the body a landing leaves: its digest and version, and what it writes, null when it stays
interface LandedBody {
  readonly digest: BodyDigest;
  readonly version: number;
  readonly written: {
    readonly row: typeof itemBody.$inferInsert;
    readonly derived: DerivedBody;
  } | null;
}

const itemIs = (accountId: string, itemId: string) =>
  and(eq(item.accountId, accountId), eq(item.id, itemId));

const sameShas = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((sha) => right.has(sha));
};

// blocks at a version, refused past what a body holds
const writtenBody = (
  scope: WriteScope,
  itemId: string,
  blocks: readonly BodyBlock[],
  version: number,
): LandedBody => {
  const derived = deriveBody(blocks);
  const row = bodyRowOf(scope.accountId, itemId, { blocks, digest: derived.digest, version });
  if (row.bytes > BODY_MAX_BYTES) {
    refuse({ kind: "too-large" });
  }
  return { digest: derived.digest, version, written: { derived, row } };
};

// the body the landing leaves, and the files the item named before it
const landedBody = async (
  scope: WriteScope,
  landing: Landing,
): Promise<{ readonly landed: LandedBody; readonly priorFiles: readonly string[] }> => {
  const { before, body, itemId } = landing;
  if (before === null) {
    return { landed: writtenBody(scope, itemId, landing.body, 1), priorFiles: [] };
  }
  const held = await readBodyFacts(scope.tx, scope.accountId, itemId);
  if (held === null) {
    throw new Error(`the item ${itemId} has no body row`);
  }
  return {
    landed:
      body === null
        ? { digest: held.digest, version: held.version, written: null }
        : writtenBody(scope, itemId, body, held.version + 1),
    priorFiles: itemFilesOf(before.fields, held.digest.files),
  };
};

const urlHeldByAnother = async (
  scope: WriteScope,
  urlKey: string,
  itemId: string,
): Promise<boolean> => {
  const held = await scope.tx
    .select({ id: item.id })
    .from(item)
    .where(
      and(
        eq(item.accountId, scope.accountId),
        eq(item.urlKey, urlKey),
        isNull(item.deletedAt),
        ne(item.id, itemId),
      ),
    )
    .limit(1);
  return held.length > 0;
};

// every rule a landing meets, before anything is written: a refusal leaves nothing to roll back
const checkLanding = async (scope: WriteScope, landing: Landing) => {
  const { fields, itemId } = landing;
  if (!libraryItemFieldsSchema.validate(fields)) {
    refuse({ kind: "too-large" });
  }
  const { landed, priorFiles } = await landedBody(scope, landing);
  const derived = deriveItem(fields, landed.digest);
  if (
    derived.urlKey !== null &&
    fields.deletedAt === null &&
    (await urlHeldByAnother(scope, derived.urlKey, itemId))
  ) {
    refuse({ kind: "url-held" });
  }
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

// a body's rows: the body at its version, and the links it holds
const landBody = async (
  scope: WriteScope,
  itemId: string,
  made: boolean,
  written: NonNullable<LandedBody["written"]>,
): Promise<void> => {
  const { accountId, tx } = scope;
  const { derived, row } = written;
  if (made) {
    await tx.insert(itemBody).values(row);
  } else {
    await tx
      .update(itemBody)
      .set(row)
      .where(and(eq(itemBody.accountId, accountId), eq(itemBody.itemId, itemId)));
    await tx
      .delete(itemLink)
      .where(and(eq(itemLink.accountId, accountId), eq(itemLink.sourceId, itemId)));
  }
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
const landDerived = async (
  scope: WriteScope,
  itemId: string,
  derived: ReturnType<typeof deriveItem>,
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

// the row the item lands as; refuses a change no rule admits, before anything is written
export const landItem = async (scope: WriteScope, landing: Landing): Promise<LiveItemRow> => {
  const { accountId, now, tx } = scope;
  const { before, fields, itemId } = landing;
  const { derived, files, landed, priorFiles } = await checkLanding(scope, landing);
  const seq = await scope.seq();
  const row = itemRowOf(accountId, {
    card: derived.card,
    fields,
    id: itemId,
    seq,
    updatedAt: now,
    urlKey: derived.urlKey,
  });
  await (before === null
    ? tx.insert(item).values(row)
    : tx.update(item).set(row).where(itemIs(accountId, itemId)));
  const { written } = landed;
  if (written !== null) {
    await landBody(scope, itemId, before === null, written);
  }
  if (
    written !== null ||
    before === null ||
    canonicalJson(before.fields) !== canonicalJson(fields)
  ) {
    const text = written === null ? await heldText(scope, itemId) : written.derived.text;
    await landDerived(scope, itemId, derived, text);
  }
  if (before === null || !sameShas(priorFiles, files)) {
    await nameItemFiles(tx, accountId, itemId, files, now);
  }
  return { card: derived.card, fields, id: itemId, seq, updatedAt: now };
};
