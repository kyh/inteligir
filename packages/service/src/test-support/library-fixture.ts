// Accounts, items and files put straight into Postgres for the library's suites, past every write
// and its rules: an item lands with the rows a write would derive for it, through the same mappers
// (`../library/library-rows`), so a read's suite needs no write path to stand on. And the library's
// rows called in process as a principal calls them, each input and output through the contract.

import { randomUUID } from "node:crypto";

import { deriveBody, deriveItem } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import {
  file,
  folder,
  item,
  itemBody,
  itemLink,
  itemSearch,
  itemTag,
} from "@repo/db/library-schema";
import { createRouterClient } from "@orpc/server";

import type { LibraryPrincipal } from "../library/library-principal";
import type { JobKick } from "../library/library-store";
import { bodyRowOf, itemRowOf, linkRowsOf, searchRowOf, tagRowsOf } from "../library/library-rows";
import type { StoredItem } from "../library/library-rows";
import { libraryRouter } from "../rpc/library-router";

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
  // when it last changed; when it was saved by default
  readonly updatedAt?: number;
}

// an item with its body, search row, tags and links, as a landing would leave them
export const seedItem = async (accountId: string, seed: ItemSeed): Promise<StoredItem> => {
  const { blocks = [], fields, id = randomUUID(), seq = 0, updatedAt = fields.savedAt } = seed;
  const body = deriveBody(blocks);
  const derived = deriveItem(fields, body.digest);
  const stored: StoredItem = {
    card: derived.card,
    fields,
    id,
    seq,
    updatedAt,
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

// a file the library holds, as a settled upload leaves it
export const seedFile = async (
  accountId: string,
  sha: string,
  {
    bytes = 10,
    mime = "image/png",
    touchedAt = 1,
  }: { readonly bytes?: number; readonly mime?: string; readonly touchedAt?: number } = {},
): Promise<void> => {
  await db.insert(file).values({
    accountId,
    bytes,
    createdAt: touchedAt,
    mime,
    pathname: `files/${accountId}/${sha}/${randomUUID()}`,
    sha256: sha,
    touchedAt,
  });
};

// one of the person's sessions on `/v1`, as admission resolves it (`../rpc/admit`)
export const sessionPrincipal = (accountId: string): LibraryPrincipal => ({
  accountId,
  actor: { door: "page", kind: "session", sessionId: randomUUID() },
});

// `kickJobs` the drain a write's jobs ask after it, which no suite starts unless it passes one
export const libraryAs = (principal: LibraryPrincipal, kickJobs?: JobKick) =>
  createRouterClient(libraryRouter, { context: { kickJobs, principal } });

// a fresh account, and the person's own calls on its library
export const personalLibrary = async () => {
  const accountId = await makeAccount();
  return { accountId, library: libraryAs(sessionPrincipal(accountId)) };
};

export interface FolderSeed {
  readonly name: string;
  readonly id?: string;
  readonly parentId?: string | null;
  // its order key among its siblings
  readonly sort?: string;
  readonly deletedAt?: number | null;
}

// a folder as a folder write would leave it, at the top by default
export const seedFolder = async (accountId: string, seed: FolderSeed): Promise<string> => {
  const { deletedAt = null, id = randomUUID(), name, parentId = null, sort = "a0" } = seed;
  await db.insert(folder).values({ accountId, deletedAt, id, name, parentId, seq: 0, sort });
  return id;
};
