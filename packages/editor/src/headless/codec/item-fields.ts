// A markdown file's frontmatter as what it says of its item. The YAML is parsed once, and each key
// the library knows is one row of `readKeys`, its reader taking what its field holds: `id`,
// `title`, `kind`, `url`, `site`, `author`, `published`, `saved`, `fetched`, `fetch-error`,
// `description`, `lang`, `tags`, `aliases` and `pinned`. What of a value its reader does not take
// stays a property under the key's own name, as every other key does whole, so a
// `published: true`, a `kind: book`, a `pinned: yes`, a `fetched:` before 1970 and the entries of
// `tags` the tag grammar refuses are kept. `id` and `saved` are the item's own, its identity and
// its instant, so neither is ever a property. A block that is not YAML is no field's, and the
// import keeps it as the note's first code block, as it keeps the keys no property holds: one
// whose name is past a line or is `__proto__`, one past what the properties' bytes hold, and an
// `id` or a `saved` that does not read. `writeFrontmatter` is the reading's inverse, an export's
// keys for an item, held to what this reader reads back of them.

import { isMap, isScalar, parseDocument, stringify } from "yaml";
import type { Document, ParsedNode } from "yaml";
import { z } from "zod";

import { isItemKind, URL_ITEM_KINDS } from "@repo/contract/items/item-kind";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { isWebUrl } from "@repo/contract/items/item-url";
import { isTagName } from "@repo/contract/knowledge/tag-grammar";
import { canonicalJson, utf8ByteLength } from "@repo/contract/library/canonical-json";
import { blankItemFields } from "@repo/contract/library/item-makes";
import type { Reading } from "@repo/contract/library/item-reading";
import { ITEM_FIELD_CAPS, propertyKeySchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields, PropertyValue } from "@repo/contract/library/library-item";
import { formatItemTime, parseItemTime } from "@repo/editor/headless/items/item-time";

type KeyValues = ReadonlyMap<string, PropertyValue>;

export interface FileFacts {
  // the `id:` the file carries, which an item link an earlier version wrote keys by
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
  // `unheld`: the keys no property holds, as YAML; null for none
  | { readonly kind: "fields"; readonly facts: FileFacts; readonly unheld: string | null };

interface ReadKeys {
  readonly facts: FileFacts;
  readonly unheld: string | null;
}

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

// what a value adds to a list's or a map's bytes as the item's caps count them, canonical JSON
const jsonBytes = (value: PropertyValue): number => utf8ByteLength(canonicalJson(value));

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
// (`reading list`, a quoted `2026`) is no tag, since no inline `#` could spell it, and one past a
// line is none an item holds
const tagOf = (entry: string): string | null => {
  const tag = (entry.startsWith("#") ? entry.slice(1) : entry).trim();
  return isTagName(tag) && tag.length <= ITEM_FIELD_CAPS.line ? tag : null;
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

// what no field took of the keys: the item's properties while a key is a property's and the
// properties' bytes hold its value, the rest kept as YAML, in the file's order, the item's own
// among them
const holdLeft = (left: KeyValues, own: ReadonlySet<string>) => {
  const held = new Map<string, PropertyValue>();
  const unheld = new Map<string, PropertyValue>();
  // the properties' braces, then each key and value and the comma before them
  let bytes = 2;
  for (const [key, value] of left) {
    const more = jsonBytes(key) + 1 + jsonBytes(value) + (held.size > 0 ? 1 : 0);
    if (
      !own.has(key) &&
      propertyKeySchema.validate(key) &&
      bytes + more <= ITEM_FIELD_CAPS.propertiesBytes
    ) {
      held.set(key, value);
      bytes += more;
    } else {
      unheld.set(key, value);
    }
  }
  return {
    properties: Object.fromEntries(held),
    unheld: unheld.size === 0 ? null : stringify(unheld, { lineWidth: 0 }).trimEnd(),
  };
};

const readKeys = (file: KeyValues): ReadKeys => {
  // what no field took of each key, which `holdLeft` keeps under the key's own name
  const left = new Map(file);
  const ownKeys = new Set<string>();
  // a key its field takes whole or not at all
  const whole = <T>(key: string, read: (value: PropertyValue) => T | null): T | null => {
    const value = file.get(key);
    const took = value === undefined ? null : read(value);
    if (took !== null) {
      left.delete(key);
    }
    return took;
  };
  // a key of the item's own, which no property keeps, so one that does not read stays YAML
  const own = <T>(key: string, read: (value: PropertyValue) => T | null): T | null => {
    ownKeys.add(key);
    return whole(key, read);
  };
  // a list or one bare string, as Obsidian accepts: each entry as `spell` writes it, the first of
  // a spelling kept, while the list holds its entries and its bytes, and what the field did not
  // take left; a key left empty leaves nothing
  const list = (key: string, spell: (entry: string) => string | null): string[] => {
    const value = file.get(key) ?? null;
    const entries = Array.isArray(value) ? value : [value];
    const took = new Map<string, string>();
    const refused: PropertyValue[] = [];
    // the list's brackets, then each entry and the comma before it
    let bytes = 2;
    for (const entry of value === null ? [] : entries) {
      const spelled = textValue.validate(entry) ? spell(entry) : null;
      const held = spelled !== null && took.has(spelled.toLowerCase());
      const more = spelled === null ? 0 : jsonBytes(spelled) + (took.size > 0 ? 1 : 0);
      const fits =
        took.size < ITEM_FIELD_CAPS.listEntries && bytes + more <= ITEM_FIELD_CAPS.listBytes;
      if (spelled !== null && !held && fits) {
        took.set(spelled.toLowerCase(), spelled);
        bytes += more;
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
  const { properties, unheld } = holdLeft(left, ownKeys);
  return { facts: { ...facts, properties }, unheld };
};

const jsonValue = z.json();

// a value as JSON; one JSON cannot spell (`.nan`, a `!!binary`) keeps its source text, as does one
// holding a `__proto__` key, which zod's JSON drops as it parses
const valueOf = (node: ParsedNode | null, doc: Document.Parsed, yaml: string): PropertyValue => {
  if (node === null) {
    return null;
  }
  const value: unknown = node.toJS(doc);
  const json = jsonValue.safeParse(value);
  return json.success && JSON.stringify(json.data) === JSON.stringify(value)
    ? json.data
    : yaml.slice(node.range[0], node.range[1]).trimEnd();
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
  return file === null ? { kind: "invalid", yaml } : { ...readKeys(file), kind: "fields" };
};

// what a file says of its item: nothing, where it has no frontmatter that reads
export const factsOf = (front: Frontmatter): FileFacts =>
  front.kind === "fields" ? front.facts : readKeys(new Map()).facts;

// what of a file's frontmatter its item cannot hold, as the YAML its note keeps: a block that is
// not YAML whole, else the keys no property holds; null for none
export const unheldYaml = (front: Frontmatter): string | null => {
  switch (front.kind) {
    case "none": {
      return null;
    }
    case "invalid": {
      return front.yaml;
    }
    case "fields": {
      return front.unheld;
    }
    // no default
  }
};

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

type Keys = ReadonlyMap<string, PropertyValue>;
type Properties = LibraryItemFields["properties"];

// the keys a list is written under, whose entries a property of the same name joins
const LIST_KEYS = ["tags", "aliases"] as const;

const isListKey = (key: string): boolean => LIST_KEYS.some((list) => list === key);

// when a file says its page was last read or tried: a waiting page says nothing, since a
// `fetched:` alone reads as read
const fetchedOf = (reading: Reading): number | null =>
  reading.state === "read" || reading.state === "failed" ? reading.at : null;

// an item's fields as the keys `readKeys` reads back, its id first; `title` only where the file's
// name cannot carry it, and a reading's keys only beside an address, since a file with none keeps
// them as properties
const fieldKeys = (id: string, fields: LibraryItemFields, title: string | null): Keys => {
  const keys = new Map<string, PropertyValue>([["id", id]]);
  const text = (key: string, value: string | null): void => {
    if (value !== null) {
      keys.set(key, value);
    }
  };
  const { reading, url } = fields;
  const fetched = url === null ? null : fetchedOf(reading);
  text("title", title);
  text("kind", fields.kind === "note" ? null : fields.kind);
  text("url", url);
  text("site", fields.site);
  text("author", fields.author);
  text("published", fields.published);
  text("description", fields.description);
  text("lang", fields.lang);
  text("saved", formatItemTime(fields.savedAt));
  text("fetched", fetched === null ? null : formatItemTime(fetched));
  text("fetch-error", url !== null && reading.state === "failed" ? reading.error : null);
  for (const key of LIST_KEYS) {
    if (fields[key].length > 0) {
      keys.set(key, fields[key]);
    }
  }
  if (fields.pinnedAt !== null) {
    keys.set("pinned", true);
  }
  return keys;
};

// the fields' keys and every property but those `left`: a property under a key a field wrote is
// left out, but for a list's, whose entries join the field's after them, as a file holds what
// the field could not read
const withProperties = (keys: Keys, properties: Properties, left: ReadonlySet<string>): Keys => {
  const all = new Map(keys);
  for (const [key, value] of Object.entries(properties)) {
    if (left.has(key)) {
      continue;
    }
    const field = keys.get(key);
    if (field === undefined) {
      all.set(key, value);
    } else if (Array.isArray(field) && isListKey(key)) {
      all.set(key, [...field, ...(Array.isArray(value) ? value : [value])]);
    }
  }
  return all;
};

const yamlOf = (keys: Keys): string => stringify(keys, { lineWidth: 0 }).trimEnd();

// the properties a file's keys do not read back as themselves: one under a key a field wrote, one
// the import reads as a field (a `url:` on an item with none), and one it keeps as no property
const notReadBack = (yaml: string, properties: Properties): string[] => {
  const front = readFrontmatter(yaml);
  const back: Properties = front.kind === "fields" ? front.facts.properties : {};
  return Object.entries(properties).flatMap(([key, value]) =>
    Object.hasOwn(back, key) && canonicalJson(back[key] ?? null) === canonicalJson(value)
      ? []
      : [key],
  );
};

interface WrittenFrontmatter {
  readonly yaml: string;
  // the properties no key of the file spells
  readonly leftOut: number;
}

const settled = (
  keys: Keys,
  properties: Properties,
  left: ReadonlySet<string>,
): WrittenFrontmatter => {
  const yaml = yamlOf(withProperties(keys, properties, left));
  const lost = notReadBack(yaml, properties).filter((key) => !left.has(key));
  return lost.length === 0
    ? { leftOut: left.size, yaml }
    : settled(keys, properties, new Set([...left, ...lost]));
};

// an item's frontmatter, in one fixed order, read back until every property it holds reads as
// itself, so a file never says what its item did not: each property that cannot is left out
export const writeFrontmatter = (
  id: string,
  fields: LibraryItemFields,
  title: string | null,
): WrittenFrontmatter => settled(fieldKeys(id, fields, title), fields.properties, new Set());
