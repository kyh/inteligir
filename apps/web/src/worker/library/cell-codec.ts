// The markdown codec's ports over the cell's SQL, read inside the write or read that uses them: a
// link names an item by its id or, when an agent wrote it by title, by the one live item titled so;
// a file the view writes `assets/<sha>` is the library's own file under that sha, its kind read
// off the type it was uploaded as. A port set lives for one call, so the titles it reads once are
// those the call's transaction sees.

import type { EditPorts } from "@repo/editor/codec/item-edit";
import type { FoundFile, ImportPorts } from "@repo/editor/codec/item-markdown";
import { viewFileAt } from "@repo/editor/codec/item-view";
import type { ViewPorts } from "@repo/editor/codec/item-view";
import type { FileKind } from "@repo/notes/items/item-kind";
import { itemCardSchema, titleKey } from "@repo/notes/library/derive-item";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { isUuidWikiAlias } from "@repo/notes/markdown/remark-wiki-link";
import type { WikiBody } from "@repo/notes/markdown/remark-wiki-link";
import { z } from "zod";

import type { CellIds } from "./cell-ids";

const cardRowSchema = z.object({ card: z.string() });
const titleRowSchema = z.object({ aliases: z.string(), id: z.string(), title: z.string() });
const mimeRowSchema = z.object({ mime: z.string() });
const namesSchema = z.array(z.string());

const JSON_TEXT = z.string().transform((text, context) => {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not JSON" });
    return z.NEVER;
  }
});

// an item's name as a link to it is written: its card's title, which falls back to its first
// heading or line; null for an id no item holds
const titleOf = (sql: SqlStatements, itemId: string): string | null => {
  const [raw] = sql.all("SELECT card FROM items WHERE id = ? AND purged = 0", [itemId]);
  return raw === undefined
    ? null
    : JSON_TEXT.pipe(itemCardSchema).parse(cardRowSchema.parse(raw).card).title;
};

// what kind of file a type uploaded as is; a type no viewer reads is a plain file
export const fileKindOfMime = (mime: string): FileKind => {
  const type = mime.toLowerCase();
  if (type === "application/pdf") {
    return "pdf";
  }
  for (const kind of ["image", "video", "audio"] as const) {
    if (type.startsWith(`${kind}/`)) {
      return kind;
    }
  }
  return "file";
};

const fileKindOf = (sql: SqlStatements, sha: string): FileKind | null => {
  const [raw] = sql.all("SELECT mime FROM blobs WHERE sha256 = ?", [sha]);
  return raw === undefined ? null : fileKindOfMime(mimeRowSchema.parse(raw).mime);
};

// every live item by the keys its title and aliases are filed under, read once a call; a key two
// items answer to is null, since a link by that title reaches neither
const titleIndex = (sql: SqlStatements): Map<string, string | null> => {
  const index = new Map<string, string | null>();
  const file = (name: string, id: string): void => {
    const key = titleKey(name);
    if (key === "") {
      return;
    }
    const held = index.get(key);
    index.set(key, held === undefined || held === id ? id : null);
  };
  for (const raw of sql.all(
    "SELECT id, title, aliases FROM items WHERE purged = 0 AND deleted_at IS NULL",
    [],
  )) {
    const row = titleRowSchema.parse(raw);
    file(row.title, row.id);
    for (const alias of JSON_TEXT.pipe(namesSchema).parse(row.aliases)) {
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

export const cellCodec = (sql: SqlStatements, ids: CellIds): CellCodec => {
  let titles: Map<string, string | null> | null = null;
  const itemByTitle = (title: string): string | null => {
    titles ??= titleIndex(sql);
    return titles.get(titleKey(title)) ?? null;
  };
  const title = (itemId: string): string | null => titleOf(sql, itemId);
  const fileAt = (url: string): FoundFile | null => {
    const file = viewFileAt(url);
    const kind = file === null ? null : fileKindOf(sql, file.sha);
    return file === null || kind === null
      ? null
      : { kind, name: file.name ?? file.sha, path: url, place: url, sha: file.sha };
  };
  // a `[[Title|id]]` the view wrote names its item by id; a `[[Title]]` an agent wrote, by title
  const wiki = (link: WikiBody, embed: boolean) => {
    const file = embed ? fileAt(link.target) : null;
    if (file !== null) {
      return { file, kind: "file" as const };
    }
    const byId = link.alias !== undefined && isUuidWikiAlias(link.alias) ? link.alias : null;
    const named = byId === null ? null : title(byId);
    const itemId = named === null ? itemByTitle(link.target) : byId;
    return itemId === null
      ? null
      : { itemId, kind: "item" as const, title: title(itemId) ?? link.target };
  };
  return {
    edit: {
      fileKind: (sha) => fileKindOf(sql, sha),
      itemByTitle,
      newAnnotationId: ids.annotation,
      newBlockId: ids.block,
      title,
    },
    importing: (now) => ({
      file: fileAt,
      newAnnotationId: ids.annotation,
      newBlockId: ids.block,
      now,
      wiki,
    }),
    view: { title },
  };
};
