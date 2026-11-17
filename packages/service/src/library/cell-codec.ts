// The markdown codec's ports over the cell's SQL, read inside the write or read that uses them: a
// page link names an item by its id, and a `[[Title]]` an agent wrote the one live item titled so;
// a file the view writes `assets/<sha>` is the library's own file under that sha, its kind read
// off the type it was uploaded as. A port set lives for one call, so the titles it reads once are
// those the call's transaction sees.

import type { EditPorts } from "@repo/editor/headless/codec/item-edit";
import type { ViewPorts } from "@repo/editor/headless/codec/item-view";
import { libraryLinks } from "@repo/editor/headless/codec/library-links";
import type { LibraryLookup } from "@repo/editor/headless/codec/library-links";
import type { BodyPorts } from "@repo/editor/headless/codec/read-body";
import { fileKindOfMime } from "@repo/contract/items/item-kind";
import type { FileKind } from "@repo/contract/items/item-kind";
import { titleKey } from "@repo/contract/library/derive-item";
import { eq, isNull } from "drizzle-orm";

import { blobs, items } from "@repo/db/cell/schema";
import { errorFields } from "../log";
import type { CellDb } from "./cell-db";
import type { CellIds } from "./cell-ids";

// an item's name as a link to it is written: its card's title, which falls back to its first
// heading or line; null for an id no item holds
const titleOf = (db: CellDb, itemId: string): string | null => {
  const row = db.select({ card: items.card }).from(items).where(eq(items.id, itemId)).get();
  return row?.card.title ?? null;
};

const fileKindOf = (db: CellDb, sha: string): FileKind | null => {
  const row = db.select({ mime: blobs.mime }).from(blobs).where(eq(blobs.sha256, sha)).get();
  return row === undefined ? null : fileKindOfMime(row.mime);
};

// every live item by the keys its title and aliases are filed under, read once a call; a key two
// items answer to is null, since a link by that title reaches neither
const titleIndex = (db: CellDb): Map<string, string | null> => {
  const index = new Map<string, string | null>();
  const file = (name: string, id: string): void => {
    const key = titleKey(name);
    if (key === "") {
      return;
    }
    const held = index.get(key);
    index.set(key, held === undefined || held === id ? id : null);
  };
  for (const row of db
    .select({ aliases: items.aliases, id: items.id, title: items.title })
    .from(items)
    .where(isNull(items.deletedAt))
    .all()) {
    file(row.title, row.id);
    for (const alias of row.aliases) {
      file(alias, row.id);
    }
  }
  return index;
};

export interface CellCodec {
  readonly view: ViewPorts;
  readonly edit: EditPorts;
  // how markdown written into a body reads as its blocks
  readonly body: BodyPorts;
}

export const cellCodec = (db: CellDb, ids: CellIds): CellCodec => {
  let titles: Map<string, string | null> | null = null;
  const lookup: LibraryLookup = {
    fileKind: (sha) => fileKindOf(db, sha),
    itemByTitle: (title) => {
      titles ??= titleIndex(db);
      return titles.get(titleKey(title)) ?? null;
    },
    title: (itemId) => titleOf(db, itemId),
  };
  const links = libraryLinks(lookup);
  return {
    body: { links, newBlockId: ids.block, wiki: links.wiki },
    edit: { ...lookup, newBlockId: ids.block },
    view: lookup,
  };
};

// a rule that failed reading text is the codec's fault and not the text's: the caller refuses the
// text as it does text it cannot hold, and the failure is said here
export const logReadFailure = (error: Error): void => {
  console.error({ event: "markdown-read-failed", ...errorFields(error) });
};
