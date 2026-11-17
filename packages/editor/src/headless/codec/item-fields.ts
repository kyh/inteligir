// A markdown file's frontmatter as what it says of its item. The YAML is parsed once, and each key
// the library knows is one row of `readKeys`, its reader taking what its field holds: `id`,
// `title`, `kind`, `url`, `site`, `author`, `published`, `saved`, `fetched`, `fetch-error`,
// `description`, `lang`, `tags`, `aliases` and `pinned`. What of a value its reader does not take
// stays a property under the key's own name, as every other key does whole, so a
// `published: true`, a `kind: book`, a `pinned: yes` and the entries of `tags` the tag grammar
// refuses are kept. `id` and `saved` are the item's own, its identity and its instant, so neither
// is ever a property. A block that is not YAML is no field's, and the import keeps it as the
// note's first code block.

import { isMap, isScalar, parseDocument } from "yaml";
import type { Document, ParsedNode } from "yaml";
import { z } from "zod";

import { isItemKind, URL_ITEM_KINDS } from "@repo/contract/items/item-kind";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { isWebUrl } from "@repo/contract/items/item-url";
import { isTagName } from "@repo/contract/knowledge/tag-grammar";
import { blankItemFields } from "@repo/contract/library/item-makes";
import type { Reading } from "@repo/contract/library/item-reading";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import type { LibraryItemFields, PropertyValue } from "@repo/contract/library/library-item";
import { parseItemTime } from "@repo/editor/headless/items/item-time";

type KeyValues = ReadonlyMap<string, PropertyValue>;

export interface FileFacts {
  // the `id:` the file carries, which a page link this app's export wrote keys by
  readonly id: string | null;
  // null where the file's own name is the title
  readonly title: string | null;
  // null where the import's own instant is
  readonly savedAt: number | null;
  readonly pinned: boolean;
  readonly reading: Reading;
  // the fields a key holds as the item does
  readonly fields: Pick<
    LibraryItemFields,
    "aliases" | "author" | "description" | "kind" | "lang" | "published" | "site" | "tags" | "url"
  >;
  // every value no field took
  readonly properties: LibraryItemFields["properties"];
}

export type Frontmatter =
  | { readonly kind: "none" }
  // a block that is not YAML, as written
  | { readonly kind: "invalid"; readonly yaml: string }
  | { readonly kind: "fields"; readonly facts: FileFacts };

// a text, the spaces around it left off, cut between characters to the `max` UTF-16 units a field
// counts; null for none left
const cut = (text: string, max: number): string | null => {
  const whole = text.trim();
  let end = 0;
  for (const char of whole) {
    if (end + char.length > max) {
      break;
    }
    end += char.length;
  }
  const kept = whole.slice(0, end).trimEnd();
  return kept === "" ? null : kept;
};

const textValue = z.string();
const textList = z.array(textValue);
const numberValue = z.number();
const flagValue = z.boolean();

// a key's text, the spaces around it left off, "" among it
const written = (value: PropertyValue): string | null =>
  textValue.validate(value) ? value.trim() : null;

const line = (value: PropertyValue): string | null =>
  textValue.validate(value) ? cut(value, ITEM_FIELD_CAPS.line) : null;

const instant = (value: PropertyValue): number | null =>
  textValue.validate(value) ? parseItemTime(value) : null;

const kindOf = (value: PropertyValue): ItemKind | null => {
  const kind = written(value)?.toLowerCase() ?? "";
  return isItemKind(kind) ? kind : null;
};

const urlOf = (value: PropertyValue): string | null => {
  const url = written(value);
  return url !== null && url.length <= ITEM_FIELD_CAPS.url && isWebUrl(url) ? url : null;
};

// `[[Steph Ango]]` and `[[people/steph|Steph Ango]]` read as the name they show
const WIKI_NAME = /^\[\[(?:[^|\]]*\|)?(?<name>[^\]]*)\]\]$/u;

const shownName = (text: string): string =>
  (WIKI_NAME.exec(text.trim())?.groups?.name ?? text).trim();

// one name or a list of them, as Obsidian writes either
const authorOf = (value: PropertyValue): string | null => {
  const names = textList.safeParse(Array.isArray(value) ? value : [value]);
  return names.success
    ? line(
        names.data
          .map(shownName)
          .filter((name) => name !== "")
          .join(", "),
      )
    : null;
};

// a date or a number is kept as written: `published` is whatever the page said
const publishedOf = (value: PropertyValue): string | null =>
  line(numberValue.validate(value) ? String(value) : value);

// a tag as Obsidian writes one, a `#` before it left off; one outside the tag grammar
// (`reading list`, a quoted `2026`) is no tag, since no inline `#` could spell it
const tagOf = (entry: string): string | null => {
  const tag = (entry.startsWith("#") ? entry.slice(1) : entry).trim();
  return isTagName(tag) ? tag : null;
};

// where the page of a file with an address stands: failed where the file says why, read where it
// says when, and waiting where a url kind says neither
const pageReading = (kind: ItemKind, at: number | null, error: string | null): Reading => {
  if (error !== null) {
    return { at, error, state: "failed" };
  }
  if (at !== null) {
    return { at, state: "read" };
  }
  return URL_ITEM_KINDS.some((urlKind) => urlKind === kind)
    ? { at, state: "pending" }
    : { state: "none" };
};

const readKeys = (file: KeyValues): FileFacts => {
  // what no field took of each key, which stays a property under it
  const left = new Map(file);
  // a key its field takes whole or not at all
  const whole = <T>(key: string, read: (value: PropertyValue) => T | null): T | null => {
    const value = file.get(key);
    const took = value === undefined ? null : read(value);
    if (took !== null) {
      left.delete(key);
    }
    return took;
  };
  // a key of the item's own, which no property keeps where it does not read
  const own = <T>(key: string, read: (value: PropertyValue) => T | null): T | null => {
    const took = whole(key, read);
    left.delete(key);
    return took;
  };
  // a list or one bare string, as Obsidian accepts: each entry as `spell` writes it, the first of
  // a spelling kept, and what the field did not take left; a key left empty leaves nothing
  const list = (key: string, spell: (entry: string) => string | null): string[] => {
    const value = file.get(key) ?? null;
    const entries = Array.isArray(value) ? value : [value];
    const took = new Map<string, string>();
    const refused: PropertyValue[] = [];
    for (const entry of value === null ? [] : entries) {
      const spelled = textValue.validate(entry) ? spell(entry) : null;
      const held = spelled !== null && took.has(spelled.toLowerCase());
      if (spelled !== null && !held && took.size < ITEM_FIELD_CAPS.listEntries) {
        took.set(spelled.toLowerCase(), spelled);
      } else if (!held) {
        refused.push(entry);
      }
    }
    if (refused.length === 0) {
      left.delete(key);
    } else {
      left.set(key, Array.isArray(value) ? refused : value);
    }
    return [...took.values()];
  };
  const url = whole("url", urlOf);
  const kind = whole("kind", kindOf) ?? "note";
  const facts: Omit<FileFacts, "properties"> = {
    fields: {
      // `alias`, Obsidian's older spelling, is read only where no `aliases` is
      aliases: list(file.has("aliases") ? "aliases" : "alias", line),
      author: whole("author", authorOf),
      description: whole("description", (value) =>
        textValue.validate(value) ? cut(value, ITEM_FIELD_CAPS.description) : null,
      ),
      kind,
      lang: whole("lang", line),
      published: whole("published", publishedOf),
      site: whole("site", line),
      tags: list("tags", tagOf),
      url,
    },
    id: own("id", line),
    pinned: whole("pinned", (value) => (flagValue.validate(value) ? value : null)) ?? false,
    // a file with no address has no page, so what it says of a reading stays a property
    reading:
      url === null
        ? { state: "none" }
        : pageReading(kind, whole("fetched", instant), whole("fetch-error", line)),
    savedAt: own("saved", instant),
    title: whole("title", written),
  };
  return { ...facts, properties: Object.fromEntries(left) };
};

const jsonValue = z.json();

// a value as JSON; one JSON cannot spell (`.nan`, a `!!binary`) keeps its source text
const valueOf = (node: ParsedNode | null, doc: Document.Parsed, yaml: string): PropertyValue => {
  if (node === null) {
    return null;
  }
  const json = jsonValue.safeParse(node.toJS(doc));
  return json.success ? json.data : yaml.slice(node.range[0], node.range[1]).trimEnd();
};

// each top-level key and its value, in the file's order; null for a block that is no YAML mapping:
// one that does not parse, one that names a key twice, or one whose root is a list or a line
const keyValues = (yaml: string): KeyValues | null => {
  const doc = parseDocument(yaml);
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return null;
  }
  try {
    return new Map(
      doc.contents.items.map(({ key, value }): [string, PropertyValue] => [
        isScalar(key) ? String(key.value) : String(key),
        valueOf(value, doc, yaml),
      ]),
    );
  } catch {
    // an alias to an anchor the block never set, or more aliases than the parser follows, throws
    // only as its value is read
    return null;
  }
};

// a file's frontmatter (its YAML, null for none), read once
export const readFrontmatter = (yaml: string | null): Frontmatter => {
  if (yaml === null || yaml.trim() === "") {
    return { kind: "none" };
  }
  const file = keyValues(yaml);
  return file === null ? { kind: "invalid", yaml } : { facts: readKeys(file), kind: "fields" };
};

// what a file says of its item: nothing, where it has no frontmatter that reads
export const factsOf = (front: Frontmatter): FileFacts =>
  front.kind === "fields" ? front.facts : readKeys(new Map());

// the title a file's item takes: its `title:`, an empty one among them, else the file's own name
export const titleOf = (facts: FileFacts, name: string): string =>
  cut(facts.title ?? name, ITEM_FIELD_CAPS.line) ?? "";

// a file's item: what its keys say over a blank item, saved at the import's instant unless a
// `saved:` says when, and pinned as of then
export const itemFields = (facts: FileFacts, name: string, now: number): LibraryItemFields => {
  const savedAt = facts.savedAt ?? now;
  return {
    ...blankItemFields(savedAt),
    ...facts.fields,
    pinnedAt: facts.pinned ? savedAt : null,
    properties: facts.properties,
    reading: facts.reading,
    title: titleOf(facts, name),
  };
};
