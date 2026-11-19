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
  readonly id: string | null;
  readonly title: string | null;
  readonly savedAt: number | null;
  readonly pinned: boolean;
  readonly reading: Reading;
  readonly fields: Pick<
    LibraryItemFields,
    "aliases" | "author" | "description" | "kind" | "lang" | "published" | "site" | "tags" | "url"
  >;
  readonly properties: LibraryItemFields["properties"];
}

export type Frontmatter =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly yaml: string }
  | { readonly kind: "fields"; readonly facts: FileFacts; readonly unheld: string | null };

interface ReadKeys {
  readonly facts: FileFacts;
  readonly unheld: string | null;
}

const cut = (text: string, max: number) => {
  const whole = text.trim();
  let end = 0;

  for (const char of whole) {
    if (end + char.length > max) {
      break;
    }

    end += char.length;
  }

  const kept = whole.slice(0, end).trimEnd();

  return (kept === "" ? null : kept) satisfies string | null;
};

const jsonBytes = (value: PropertyValue) => utf8ByteLength(canonicalJson(value)) satisfies number;

const textValue = z.string();
const textList = z.array(textValue);
const numberValue = z.number();
const flagValue = z.boolean();

const written = (value: PropertyValue) =>
  (textValue.validate(value) ? value.trim() : null) satisfies string | null;

const line = (value: PropertyValue) =>
  (textValue.validate(value) ? cut(value, ITEM_FIELD_CAPS.line) : null) satisfies string | null;

const instant = (value: PropertyValue) =>
  (textValue.validate(value) ? parseItemTime(value) : null) satisfies number | null;

const kindOf = (value: PropertyValue) => {
  const kind = written(value)?.toLowerCase() ?? "";

  return (isItemKind(kind) ? kind : null) satisfies ItemKind | null;
};

const urlOf = (value: PropertyValue) => {
  const url = written(value);

  return (
    url !== null && url.length <= ITEM_FIELD_CAPS.url && isWebUrl(url) ? url : null
  ) satisfies string | null;
};

const WIKI_NAME = /^\[\[(?:[^|\]]*\|)?(?<name>[^\]]*)\]\]$/u;

const shownName = (text: string) =>
  (WIKI_NAME.exec(text.trim())?.groups?.name ?? text).trim() satisfies string;

const authorOf = (value: PropertyValue) => {
  const names = textList.safeParse(Array.isArray(value) ? value : [value]);

  return (
    names.success
      ? line(
          names.data
            .map(shownName)
            .filter((name) => name !== "")
            .join(", "),
        )
      : null
  ) satisfies string | null;
};

const publishedOf = (value: PropertyValue) =>
  line(numberValue.validate(value) ? String(value) : value) satisfies string | null;

const tagOf = (entry: string) => {
  const tag = (entry.startsWith("#") ? entry.slice(1) : entry).trim();

  return (isTagName(tag) && tag.length <= ITEM_FIELD_CAPS.line ? tag : null) satisfies
    | string
    | null;
};

const pageReading = (kind: ItemKind, at: number | null, error: string | null) => {
  if (error !== null) {
    return { at, error, state: "failed" } satisfies Reading;
  }

  if (at !== null) {
    return { at, state: "read" } satisfies Reading;
  }

  return (
    URL_ITEM_KINDS.some((urlKind) => urlKind === kind)
      ? { at, state: "pending" }
      : { state: "none" }
  ) satisfies Reading;
};

const holdLeft = (left: KeyValues, own: ReadonlySet<string>) => {
  const held = new Map<string, PropertyValue>();
  const unheld = new Map<string, PropertyValue>();
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

const readKeys = (file: KeyValues) => {
  const left = new Map(file);
  const ownKeys = new Set<string>();

  const whole = <T>(key: string, read: (value: PropertyValue) => T | null) => {
    const value = file.get(key);
    const took = value === undefined ? null : read(value);

    if (took !== null) {
      left.delete(key);
    }

    return took satisfies T | null;
  };

  const own = <T>(key: string, read: (value: PropertyValue) => T | null) => {
    ownKeys.add(key);

    return whole(key, read) satisfies T | null;
  };

  const list = (key: string, spell: (entry: string) => string | null) => {
    const value = file.get(key) ?? null;
    const entries = Array.isArray(value) ? value : [value];
    const took = new Map<string, string>();
    const refused: PropertyValue[] = [];
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

    return [...took.values()] satisfies string[];
  };

  const url = whole("url", urlOf);
  const kind = whole("kind", kindOf) ?? "note";

  const facts: Omit<FileFacts, "properties"> = {
    fields: {
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
    reading:
      url === null
        ? { state: "none" }
        : pageReading(kind, whole("fetched", instant), whole("fetch-error", line)),
    savedAt: own("saved", instant),
    title: whole("title", written),
  };

  const { properties, unheld } = holdLeft(left, ownKeys);

  return { facts: { ...facts, properties }, unheld } satisfies ReadKeys;
};

const jsonValue = z.json();

const valueOf = (node: ParsedNode | null, doc: Document.Parsed, yaml: string) => {
  if (node === null) {
    return null satisfies PropertyValue;
  }

  const value: unknown = node.toJS(doc);
  const json = jsonValue.safeParse(value);

  return (
    json.success && JSON.stringify(json.data) === JSON.stringify(value)
      ? json.data
      : yaml.slice(node.range[0], node.range[1]).trimEnd()
  ) satisfies PropertyValue;
};

const keyValues = (yaml: string) => {
  const doc = parseDocument(yaml);

  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return null satisfies KeyValues | null;
  }

  try {
    return new Map(
      doc.contents.items.map(
        ({ key, value }) =>
          [isScalar(key) ? String(key.value) : String(key), valueOf(value, doc, yaml)] satisfies [
            string,
            PropertyValue,
          ],
      ),
    ) satisfies KeyValues | null;
  } catch {
    return null satisfies KeyValues | null;
  }
};

export const readFrontmatter = (yaml: string | null) => {
  if (yaml === null || yaml.trim() === "") {
    return { kind: "none" } satisfies Frontmatter;
  }

  const file = keyValues(yaml);

  return (
    file === null ? { kind: "invalid", yaml } : { ...readKeys(file), kind: "fields" }
  ) satisfies Frontmatter;
};

export const factsOf = (front: Frontmatter) =>
  (front.kind === "fields" ? front.facts : readKeys(new Map()).facts) satisfies FileFacts;

export const unheldYaml = (front: Frontmatter) => {
  switch (front.kind) {
    case "none": {
      return null satisfies string | null;
    }

    case "invalid": {
      return front.yaml satisfies string | null;
    }

    case "fields": {
      return front.unheld satisfies string | null;
    }

    default: {
      throw new Error(`unexpected ${String(front satisfies never)}`);
    }
  }
};

export const titleOf = (facts: FileFacts, name: string) =>
  (cut(facts.title ?? name, ITEM_FIELD_CAPS.line) ?? "") satisfies string;

export const itemFields = (facts: FileFacts, name: string, now: number) => {
  const savedAt = facts.savedAt ?? now;

  return {
    ...blankItemFields(savedAt),
    ...facts.fields,
    pinnedAt: facts.pinned ? savedAt : null,
    properties: facts.properties,
    reading: facts.reading,
    title: titleOf(facts, name),
  } satisfies LibraryItemFields;
};

type Keys = ReadonlyMap<string, PropertyValue>;

type Properties = LibraryItemFields["properties"];

const LIST_KEYS = ["tags", "aliases"] as const;

const isListKey = (key: string) => LIST_KEYS.some((list) => list === key) satisfies boolean;

const fetchedOf = (reading: Reading) =>
  (reading.state === "read" || reading.state === "failed" ? reading.at : null) satisfies
    | number
    | null;

const fieldKeys = (id: string, fields: LibraryItemFields, title: string | null) => {
  const keys = new Map<string, PropertyValue>([["id", id]]);

  const text = (key: string, value: string | null) => {
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

  return keys satisfies Keys;
};

const withProperties = (keys: Keys, properties: Properties, left: ReadonlySet<string>) => {
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

  return all satisfies Keys;
};

const yamlOf = (keys: Keys) => stringify(keys, { lineWidth: 0 }).trimEnd() satisfies string;

const notReadBack = (yaml: string, properties: Properties) => {
  const front = readFrontmatter(yaml);
  const back: Properties = front.kind === "fields" ? front.facts.properties : {};

  return Object.entries(properties).flatMap(([key, value]) =>
    Object.hasOwn(back, key) && canonicalJson(back[key] ?? null) === canonicalJson(value)
      ? []
      : [key],
  ) satisfies string[];
};

interface WrittenFrontmatter {
  readonly yaml: string;
  readonly leftOut: number;
}

const settled: (
  keys: Keys,
  properties: Properties,
  left: ReadonlySet<string>,
) => WrittenFrontmatter = (keys, properties, left) => {
  const yaml = yamlOf(withProperties(keys, properties, left));
  const lost = notReadBack(yaml, properties).filter((key) => !left.has(key));

  return lost.length === 0
    ? { leftOut: left.size, yaml }
    : settled(keys, properties, new Set([...left, ...lost]));
};

export const writeFrontmatter = (id: string, fields: LibraryItemFields, title: string | null) =>
  settled(fieldKeys(id, fields, title), fields.properties, new Set()) satisfies WrittenFrontmatter;
