// Accounts and items put straight into Postgres for the library's suites, past every write and its
// rules: an item lands with the rows a write would derive for it, through the same mappers
// (`../library/library-rows`), so a read's suite needs no write path to stand on.

import { randomUUID } from "node:crypto";

import { deriveBody, deriveItem } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { item, itemBody, itemLink, itemSearch, itemTag } from "@repo/db/library-schema";

import { bodyRowOf, itemRowOf, linkRowsOf, searchRowOf, tagRowsOf } from "../library/library-rows";
import type { StoredItem } from "../library/library-rows";

// a user of its own, whose id is the account's library
export const makeAccount = async (): Promise<string> => {
  const id = randomUUID();
  await db.insert(user).values({ email: `${id}@library.test`, id, name: "Library fixture" });
  return id;
};

export interface ItemSeed {
  readonly fields: LibraryItemFields;
  readonly blocks?: readonly BodyBlock[];
  readonly id?: string;
  // the sequence of the write it stands for; none took one by default
  readonly seq?: number;
}

// an item with its body, search row, tags and links, as a landing would leave them
export const seedItem = async (accountId: string, seed: ItemSeed): Promise<StoredItem> => {
  const { blocks = [], fields, id = randomUUID(), seq = 0 } = seed;
  const body = deriveBody(blocks);
  const derived = deriveItem(fields, body.digest);
  const stored: StoredItem = {
    card: derived.card,
    fields,
    id,
    seq,
    updatedAt: fields.savedAt,
    urlKey: derived.urlKey,
  };
  const tags = tagRowsOf(accountId, id, derived.tags);
  const links = linkRowsOf(accountId, id, body.links);
  await db.transaction(async (tx) => {
    await tx.insert(item).values(itemRowOf(accountId, stored));
    await tx
      .insert(itemBody)
      .values(bodyRowOf(accountId, id, { blocks, digest: body.digest, version: 1 }));
    await tx
      .insert(itemSearch)
      .values(searchRowOf(accountId, id, { ...derived.search, body: body.text }));
    if (tags.length > 0) {
      await tx.insert(itemTag).values(tags);
    }
    if (links.length > 0) {
      await tx.insert(itemLink).values(links);
    }
  });
  return stored;
};
