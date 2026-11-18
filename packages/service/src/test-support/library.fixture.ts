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

export const makeAccount = async () => {
  const id = randomUUID();
  await db.insert(user).values({ email: `${id}@library.test`, id, name: "Library fixture" });

  return id;
};

export interface ItemSeed {
  readonly fields: LibraryItemFields;
  readonly blocks?: readonly BodyBlock[];
  readonly id?: string;
  readonly seq?: number;
  readonly updatedAt?: number;
}

export const seedItem = async (accountId: string, seed: ItemSeed) => {
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

export const seedFile = async (
  accountId: string,
  sha: string,
  {
    bytes = 10,
    mime = "image/png",
    touchedAt = 1,
  }: { readonly bytes?: number; readonly mime?: string; readonly touchedAt?: number } = {},
) => {
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

export const sessionPrincipal = (accountId: string) =>
  ({
    accountId,
    actor: { door: "page", kind: "session", sessionId: randomUUID() },
  }) satisfies LibraryPrincipal;

export const libraryAs = (principal: LibraryPrincipal, kickJobs?: JobKick) =>
  createRouterClient(libraryRouter, { context: { kickJobs, principal } });

export const personalLibrary = async () => {
  const accountId = await makeAccount();

  return { accountId, library: libraryAs(sessionPrincipal(accountId)) };
};

export interface FolderSeed {
  readonly name: string;
  readonly id?: string;
  readonly parentId?: string | null;
  readonly sort?: string;
  readonly deletedAt?: number | null;
}

export const seedFolder = async (accountId: string, seed: FolderSeed) => {
  const { deletedAt = null, id = randomUUID(), name, parentId = null, sort = "a0" } = seed;
  await db.insert(folder).values({ accountId, deletedAt, id, name, parentId, seq: 0, sort });

  return id;
};
