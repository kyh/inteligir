import { randomUUID } from "node:crypto";

import { deriveBody, deriveItem } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { blankItemFields } from "@repo/contract/library/item-makes";
import { file, item, itemBody, itemLink, itemSearch, itemTag } from "@repo/db/library-schema";
import { createRouterClient } from "@orpc/server";

import type { LibraryPrincipal } from "../library/library-principal";
import { mintLibraryId } from "../library/library-ids";
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
  readonly kind?: "folder" | "list" | "note";
  readonly parentId?: string | null;
  readonly deletedAt?: number | null;
  readonly savedAt?: number;
}

export const seedFolder = async (accountId: string, seed: FolderSeed) => {
  const {
    deletedAt = null,
    id = randomUUID(),
    kind = "folder",
    name,
    parentId = null,
    savedAt = 1,
  } = seed;

  await seedItem(accountId, {
    fields: { ...blankItemFields(savedAt), deletedAt, kind, parentId, title: name },
    id,
  });

  return id;
};

type FixtureLibrary = ReturnType<typeof libraryAs>;

export const createFolder = async (
  library: FixtureLibrary,
  title: string,
  more: { readonly kind?: "folder" | "list"; readonly parentId?: string | null } = {},
) => {
  const id = mintLibraryId(Date.now());
  await library.items.create({
    blocks: [],
    id,
    kind: more.kind ?? "folder",
    parentId: more.parentId ?? null,
    savedAt: 1,
    tags: [],
    title,
  });

  return id;
};
