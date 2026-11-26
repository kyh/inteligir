import { urlKey } from "@repo/contract/items/item-url";
import { sameJson } from "@repo/contract/library/canonical-json";
import { itemFilesOf } from "@repo/contract/library/cell-rules";
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
import { settledBody } from "@repo/editor/headless/formulas/pill-nodes";
import { and, eq, isNull, ne } from "drizzle-orm";

import { missingFiles, nameItemFiles, nameNewItemFiles } from "./file-names";
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
import { askMeaning } from "./meaning-job";
import { askPdfTexts } from "./pdf-text-job";
import { anyOf, chunksOf } from "./set-sql";

export interface LiveItemRow {
  readonly card: ItemCard;
  readonly fields: LibraryItemFields;
  readonly id: string;
  readonly seq: number;
  readonly updatedAt: number;
}

export interface Landing {
  readonly itemId: string;
  readonly before: StoredItem;
  readonly fields: LibraryItemFields;
  readonly body: readonly BodyBlock[] | null;
}

export interface NewItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly blocks: readonly BodyBlock[];
}

interface WrittenBody {
  readonly row: typeof itemBody.$inferInsert;
  readonly derived: DerivedBody;
}

interface LandedBody {
  readonly digest: BodyDigest;
  readonly version: number;
  readonly written: WrittenBody | null;
  readonly priorDigest: BodyDigest;
}

const itemIs = (accountId: string, itemId: string) =>
  and(eq(item.accountId, accountId), eq(item.id, itemId));

const sameShas = (a: readonly string[], b: readonly string[]) => {
  const left = new Set(a);
  const right = new Set(b);

  return left.size === right.size && [...left].every((sha) => right.has(sha));
};

const bodyAt = (
  accountId: string,
  itemId: string,
  blocks: readonly BodyBlock[],
  version: number,
) => {
  const derived = deriveBody(blocks);
  const row = bodyRowOf(accountId, itemId, { blocks, digest: derived.digest, version });

  return (row.bytes > BODY_MAX_BYTES ? null : { derived, row }) satisfies WrittenBody | null;
};

const landedBody = async (scope: WriteScope, landing: Landing) => {
  const { body, itemId } = landing;
  const held = await readBodyFacts(scope.tx, scope.accountId, itemId);

  if (held === null) {
    throw new Error(`the item ${itemId} has no body row`);
  }

  const priorDigest = held.digest;

  if (body === null) {
    return {
      digest: priorDigest,
      priorDigest,
      version: held.version,
      written: null,
    } satisfies LandedBody;
  }

  const version = held.version + 1;
  const written = bodyAt(scope.accountId, itemId, body, version) ?? refuse({ kind: "too-large" });

  return { digest: written.derived.digest, priorDigest, version, written } satisfies LandedBody;
};

const urlHeldByAnother = async (scope: WriteScope, key: string, itemId: string) => {
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

  const priorFiles = itemFilesOf(before.fields, landed.priorDigest.files);
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

const replaceBody = async (scope: WriteScope, itemId: string, { derived, row }: WrittenBody) => {
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

const heldText = async (scope: WriteScope, itemId: string) => {
  const [row] = await scope.tx
    .select({ text: itemSearch.text })
    .from(itemSearch)
    .where(and(eq(itemSearch.accountId, scope.accountId), eq(itemSearch.itemId, itemId)));

  return row?.text ?? "";
};

const tagColumns = (tags: DerivedItem["tags"]) => tags.map(({ origin, tag }) => [origin, tag]);

const replaceTags = async (scope: WriteScope, itemId: string, derived: DerivedItem) => {
  const { accountId, tx } = scope;
  await tx.delete(itemTag).where(and(eq(itemTag.accountId, accountId), eq(itemTag.itemId, itemId)));
  const tags = tagRowsOf(accountId, itemId, derived.tags);

  if (tags.length > 0) {
    await tx.insert(itemTag).values(tags).onConflictDoNothing();
  }
};

const replaceSearch = async (
  scope: WriteScope,
  itemId: string,
  derived: DerivedItem,
  text: string,
) => {
  const { accountId, tx } = scope;
  const search = searchRowOf(accountId, itemId, { ...derived.search, body: text });
  await askMeaning(scope);
  await tx
    .insert(itemSearch)
    .values(search)
    .onConflictDoUpdate({
      set: { text: search.text, vec: search.vec },
      target: [itemSearch.accountId, itemSearch.itemId],
    });
};

export const landItem = async (scope: WriteScope, landing: Landing) => {
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

  const prior = deriveItem(before.fields, landed.priorDigest);

  if (!sameJson(tagColumns(prior.tags), tagColumns(derived.tags))) {
    await replaceTags(scope, itemId, derived);
  }

  if (written !== null || !sameJson(prior.search, derived.search)) {
    const text = written === null ? await heldText(scope, itemId) : written.derived.text;
    await replaceSearch(scope, itemId, derived, text);
  }

  if (!sameShas(priorFiles, files)) {
    await nameItemFiles(tx, accountId, itemId, files, now);
  }

  if (setId !== null) {
    await recordLanding(scope, setId, {
      after: fields,
      before: before.fields,
      bodyFiles: written === null ? [] : landed.priorDigest.files,
      itemId,
    });
  }

  await askPdfTexts(scope, [{ before: before.fields, fields, id: itemId }]);

  return { card: derived.card, fields, id: itemId, seq, updatedAt: now } satisfies LiveItemRow;
};

const liveKeyOf = ({ deletedAt, url }: LibraryItemFields) =>
  deletedAt !== null || url === null ? null : urlKey(url);

interface HeldKeys {
  readonly ids: ReadonlySet<string>;
  readonly urlKeys: ReadonlySet<string>;
}

const heldKeys = async (scope: WriteScope, made: readonly NewItem[]) => {
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
  } satisfies HeldKeys;
};

interface Candidate {
  readonly made: NewItem;
  readonly body: WrittenBody;
  readonly derived: DerivedItem;
  readonly files: readonly string[];
}

const refused = (refusal: LibraryRefusal) =>
  ({ ok: false, refusal }) satisfies LibraryResult<never>;

const candidateOf = (accountId: string, made: NewItem, held: HeldKeys) => {
  if (held.ids.has(made.id)) {
    return refused({ kind: "conflict" });
  }

  if (!libraryItemFieldsSchema.validate(made.fields)) {
    return refused({ kind: "too-large" });
  }

  const blocks = settledBody(made.blocks);
  const body = blocks === null ? null : bodyAt(accountId, made.id, blocks, 1);

  if (body === null) {
    return refused({ kind: "too-large" });
  }

  const key = liveKeyOf(made.fields);

  if (key !== null && held.urlKeys.has(key)) {
    return refused({ kind: "url-held" });
  }

  const derived = deriveItem(made.fields, body.derived.digest);
  const files = itemFilesOf(made.fields, body.derived.digest.files);

  return { ok: true, value: { body, derived, files, made } } satisfies LibraryResult<Candidate>;
};

const claimed = (checked: readonly LibraryResult<Candidate>[], missing: ReadonlySet<string>) => {
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

const insertMade = async (scope: WriteScope, landed: readonly Candidate[]) => {
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

  if (rows.length > 0) {
    await askMeaning(scope);
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

  await askPdfTexts(
    scope,
    landed.map(({ made }) => ({ before: null, fields: made.fields, id: made.id })),
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

export const landNewItems: (
  scope: WriteScope,
  made: readonly NewItem[],
) => Promise<LibraryResult<LiveItemRow>[]> = async (
  scope: WriteScope,
  made: readonly NewItem[],
) => {
  const { accountId, now, tx } = scope;

  if (made.length === 0) {
    return [] satisfies LibraryResult<LiveItemRow>[];
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
