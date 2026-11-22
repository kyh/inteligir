import { ITEM_KINDS } from "@repo/contract/items/item-kind";
import type { LibraryScope } from "@repo/contract/library-scope";
import { deriveBody, deriveItem } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { LibraryIndex, scopeFilter } from "@repo/contract/library/library-index";
import type { ListingPage, ListingQuery, ListingRow } from "@repo/contract/library/library-index";
import { listingSortSchema } from "@repo/contract/library/listing-sort";
import { compareText } from "@repo/contract/library/order-key";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { mulberry32, pick } from "@repo/contract/test-support/seeded-random.test-utils";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { makeAccount, seedItem } from "../test-support/library.fixture";
import { listingChildren, listingItems, listingScopes, listingTitles } from "./library-listing";

const SAVED_AT = Date.UTC(2026, 9, 1);
const ITEMS = 500;

const TITLES = [
  "Apple",
  "apple",
  "Äpfel",
  "zebra",
  "Zebra",
  "\u{1F600} smile",
  "\u{FF5E} tilde",
  "",
  "Ωmega",
  "émile",
  "Emile",
  "_under",
  "10 things",
];

const TAGS = [
  "Work",
  "work",
  "work/garden",
  "Work/Garden",
  "home",
  "read",
  "read/later",
  "readme",
  "tag_1",
  "tag_1/y",
  "tagx1/y",
  "tag%2",
];

const FOLDER_NAMES = ["Projects", "Garden", "Archive", "garden", "Ünder"];

const hex = (rand: () => number, length: number) =>
  Array.from({ length }, () => Math.floor(rand() * 16).toString(16)).join("");

const idOf = (rand: () => number) => {
  const id = `${hex(rand, 8)}-${hex(rand, 4)}-4${hex(rand, 3)}-a${hex(rand, 3)}-${hex(rand, 12)}`;

  return rand() < 0.2 ? id.toUpperCase() : id;
};

const chance = (rand: () => number, odds: number) => rand() < odds;

const rowOf = (id: string, fields: LibraryItemFields, blocks: BodyBlock[], updatedAt: number) => {
  const derived = deriveItem(fields, deriveBody(blocks).digest);

  return {
    deletedAt: fields.deletedAt,
    id,
    kind: fields.kind,
    parentId: fields.parentId,
    pinnedAt: fields.pinnedAt,
    savedAt: fields.savedAt,
    tags: [...new Set(derived.tags.map(({ tag }) => tag))].toSorted(compareText),
    title: derived.card.title,
    updatedAt,
    url: fields.url,
  } satisfies ListingRow;
};

const PARENT_KINDS = ["folder", "folder", "folder", "list", "note"] as const;

const randomParents = async (
  accountId: string,
  rand: () => number,
  index: LibraryIndex<ListingRow>,
) => {
  const all: string[] = [];

  for (let n = 0; n < 12; n += 1) {
    const id = idOf(rand);

    const fields = noteFixture({
      deletedAt: n % 5 === 4 ? SAVED_AT : null,
      kind: pick(rand, PARENT_KINDS),
      parentId: all.length === 0 || chance(rand, 0.4) ? null : pick(rand, all),
      savedAt: SAVED_AT,
      title: pick(rand, FOLDER_NAMES),
    });

    await seedItem(accountId, { fields, id, updatedAt: SAVED_AT });
    index.upsert(rowOf(id, fields, [], SAVED_AT));
    all.push(id);
  }

  return all;
};

const parentOf = (rand: () => number, parents: readonly string[]) => {
  const roll = rand();

  if (roll < 0.35) {
    return null;
  }

  return roll < 0.95 ? pick(rand, parents) : idOf(rand);
};

const randomLibrary = async (seed: number) => {
  const rand = mulberry32(seed);
  const accountId = await makeAccount();
  const index = new LibraryIndex<ListingRow>();
  const folderIds = await randomParents(accountId, rand, index);
  const ids: string[] = [];

  for (let n = 0; n < ITEMS; n += 1) {
    const id = idOf(rand);
    const kind = pick(rand, ITEM_KINDS);
    const savedAt = SAVED_AT + Math.floor(rand() * 60) * 1000;

    const blocks: BodyBlock[] = [
      {
        block: paragraph(
          "p1",
          chance(rand, 0.2) ? `Lead ${String(n)} #${pick(rand, TAGS)}` : `Lead ${String(n)}`,
        ),
        section: "note",
      },
    ];

    const fields = noteFixture({
      deletedAt: chance(rand, 0.15) ? savedAt + 1 : null,
      kind,
      parentId: parentOf(rand, folderIds),
      pinnedAt: chance(rand, 0.1) ? savedAt : null,
      savedAt,
      tags: [...new Set(Array.from({ length: Math.floor(rand() * 4) }, () => pick(rand, TAGS)))],
      title: `${pick(rand, TITLES)}${chance(rand, 0.5) ? ` ${String(n % 7)}` : ""}`,
      url: kind === "link" && chance(rand, 0.5) ? `https://example.com/${String(n)}` : null,
    });

    const updatedAt = savedAt + Math.floor(rand() * 30) * 1000;
    await seedItem(accountId, { blocks, fields, id, updatedAt });
    index.upsert(rowOf(id, fields, blocks, updatedAt));
    ids.push(id);
  }

  return { accountId, folderIds, ids, index, rand };
};

const pageFacts = (page: ListingPage<ListingRow>) => ({
  kindCounts: page.kindCounts,
  next: page.next,
  rows: page.items.map(({ id, tags }) => [id, ...tags].join(" ")),
  total: page.total,
});

const query = (overrides: Partial<ListingQuery>) =>
  ({
    deleted: false,
    limit: 1000,
    offset: 0,
    order: { by: "saved" },
    ...overrides,
  }) satisfies ListingQuery;

const KIND_FILTERS = [undefined, ["note"], ["link", "pdf", "image"]] as const;

dbSuite("the SQL listing beside the library model's", () => {
  it(
    "answers every scope, sort, kind filter, page and search order alike, and counts the rail alike",
    { timeout: 120_000 },
    async () => {
      const { accountId, folderIds, ids, index, rand } = await randomLibrary(0x11_57);

      const expectAlike = async (asked: ListingQuery, label: string) => {
        const facts = pageFacts(await listingItems(db, accountId, asked));
        expect(facts, label).toStrictEqual(pageFacts(index.items(asked)));

        return facts;
      };

      const scopes: LibraryScope[] = [
        { kind: "all" },
        { kind: "unsorted" },
        { kind: "deleted" },
        ...[...folderIds, idOf(rand)].map(
          (parentId) =>
            ({
              parentId,
              kind: "parent",
            }) satisfies LibraryScope,
        ),
        ...[...TAGS, "WORK", "tag_", "nope", "Inline"].map(
          (tag) =>
            ({
              kind: "tag",
              tag,
            }) satisfies LibraryScope,
        ),
      ];

      for (const scope of scopes) {
        for (const sort of listingSortSchema.options) {
          for (const kinds of KIND_FILTERS) {
            await expectAlike(
              query({ ...scopeFilter(scope), kinds, order: { by: sort } }),
              `${JSON.stringify(scope)} by ${sort} of ${String(kinds)}`,
            );
          }
        }
      }

      for (const sort of listingSortSchema.options) {
        for (let offset = 0; ; offset += 37) {
          const facts = await expectAlike(
            query({ limit: 37, offset, order: { by: sort } }),
            `page at ${String(offset)} by ${sort}`,
          );

          if (facts.next === null) {
            break;
          }
        }
      }

      const [parentId] = folderIds;

      for (const filters of [
        { pinned: true },
        { pinned: false, tag: "work" },
        { sinceMs: SAVED_AT + 20_000 },
        { beforeMs: SAVED_AT + 30_000, sinceMs: SAVED_AT + 10_000 },
        { parentId, pinned: false, tag: "read" },
      ]) {
        await expectAlike(query({ ...filters, kinds: ["note", "link"] }), JSON.stringify(filters));
      }

      const rank = new Map(
        ids.filter(() => chance(rand, 0.3)).map((id) => [id, Math.floor(rand() * 40)]),
      );

      for (const filters of [
        { deleted: false },
        { deleted: true },
        { deleted: false, tag: "work" },
        { deleted: false, parentId: null },
      ]) {
        for (const kinds of KIND_FILTERS) {
          await expectAlike(
            query({ ...filters, kinds, limit: 25, offset: 10, order: { by: "rank", rank } }),
            `ranked ${JSON.stringify(filters)} of ${String(kinds)}`,
          );
        }
      }

      await expect(listingScopes(db, accountId)).resolves.toStrictEqual(index.scopes());

      for (const under of [null, ...folderIds, ...ids.slice(0, 40)]) {
        await expect(
          listingChildren(db, accountId, under),
          `children of ${String(under)}`,
        ).resolves.toStrictEqual(index.children(under));
      }

      await expect(listingTitles(db, accountId)).resolves.toStrictEqual(index.titles());
    },
  );
});
