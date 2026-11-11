// The markdown codec's ports over the cell's SQL, read inside the write or read that uses them: a
// page link names an item by its id, and a `[[Title]]` an agent wrote the one live item titled so;
// a file the view writes `assets/<sha>` is the library's own file under that sha, its kind read
// off the type it was uploaded as. A port set lives for one call, so the titles it reads once are
// those the call's transaction sees.

import type { EditPorts } from "@repo/editor/codec/item-edit";
import type { FoundFile, ImportPorts } from "@repo/editor/codec/item-markdown";
import { viewFileAt } from "@repo/editor/codec/item-view";
import type { ViewPorts } from "@repo/editor/codec/item-view";
import { libraryLinks } from "@repo/editor/codec/library-links";
import { fileKindOfMime } from "@repo/contract/items/item-kind";
import type { FileKind } from "@repo/contract/items/item-kind";
import { itemCardSchema, titleKey } from "@repo/contract/library/derive-item";
import { jsonTextSchema } from "./sql-value";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { blobs, items } from "@repo/db/cell/schema";
import type { CellDb } from "./cell-db";
import type { CellIds } from "./cell-ids";

// a live item's row holds every field; only a purged one's are null
const titleRowSchema = z.object({ aliases: z.string(), id: z.string(), title: z.string() });
const namesSchema = z.array(z.string());

// an item's name as a link to it is written: its card's title, which falls back to its first
// heading or line; null for an id no item holds
const titleOf = (db: CellDb, itemId: string): string | null => {
  const row = db
    .select({ card: items.card })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.purged, 0)))
    .get();
  return row === undefined ? null : jsonTextSchema.pipe(itemCardSchema).parse(row.card).title;
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
  for (const held of db
    .select({ aliases: items.aliases, id: items.id, title: items.title })
    .from(items)
    .where(and(eq(items.purged, 0), isNull(items.deletedAt)))
    .all()) {
    const row = titleRowSchema.parse(held);
    file(row.title, row.id);
    for (const alias of jsonTextSchema.pipe(namesSchema).parse(row.aliases)) {
      file(alias, row.id);
    }
  }
  return index;
};

export interface CellCodec {
  readonly view: ViewPorts;
  readonly edit: EditPorts;
  readonly importing: (now: number) => ImportPorts;
}

export const cellCodec = (db: CellDb, ids: CellIds): CellCodec => {
  let titles: Map<string, string | null> | null = null;
  const itemByTitle = (title: string): string | null => {
    titles ??= titleIndex(db);
    return titles.get(titleKey(title)) ?? null;
  };
  const title = (itemId: string): string | null => titleOf(db, itemId);
  const fileAt = (url: string): FoundFile | null => {
    const file = viewFileAt(url);
    const kind = file === null ? null : fileKindOf(db, file.sha);
    return file === null || kind === null
      ? null
      : { kind, name: file.name ?? file.sha, path: url, place: url, sha: file.sha };
  };
  const fileKind = (sha: string): FileKind | null => fileKindOf(db, sha);
  const links = libraryLinks({ fileKind, itemByTitle, title });
  return {
    edit: {
      fileKind,
      itemByTitle,
      newBlockId: ids.block,
      title,
    },
    importing: (now) => ({
      file: fileAt,
      item: links.item,
      newBlockId: ids.block,
      now,
      wiki: links.wiki,
    }),
    view: { title },
  };
};
