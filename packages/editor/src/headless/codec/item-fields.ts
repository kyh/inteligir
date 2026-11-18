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
import { parseItemTime } from "@repo/editor/headless/items/item-time";

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

  return kept === "" ? null : kept;
};

const jsonBytes = (value: PropertyValue) => utf8ByteLength(canonicalJson(value));

const textValue = z.string();
const textList = z.array(textValue);
const numberValue = z.number();
const flagValue = z.boolean();

const written = (value: PropertyValue) => (textValue.validate(value) ? value.trim() : null);

const line = (value: PropertyValue) =>
  textValue.validate(value) ? cut(value, ITEM_FIELD_CAPS.line) : null;

const instant = (value: PropertyValue) => (textValue.validate(value) ? parseItemTime(value) : null);

const kindOf = (value: PropertyValue) => {
  const kind = written(value)?.toLowerCase() ?? "";

  return isItemKind(kind) ? kind : null;
};

const urlOf = (value: PropertyValue) => {
  const url = written(value);

  return url !== null && url.length <= ITEM_FIELD_CAPS.url && isWebUrl(url) ? url : null;
};

const WIKI_NAME = /^\[\[(?:[^|\]]*\|)?(?<name>[^\]]*)\]\]$/u;

const shownName = (text: string) => (WIKI_NAME.exec(text.trim())?.groups?.name ?? text).trim();

const authorOf = (value: PropertyValue) => {
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

const publishedOf = (value: PropertyValue) =>
  line(numberValue.validate(value) ? String(value) : value);

const tagOf = (entry: string) => {
  const tag = (entry.startsWith("#") ? entry.slice(1) : entry).trim();

  return isTagName(tag) && tag.length <= ITEM_FIELD_CAPS.line ? tag : null;
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

    return took;
  };

  const own = <T>(key: string, read: (value: PropertyValue) => T | null) => {
    ownKeys.add(key);

    return whole(key, read);
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
    return null;
  }

  const value: unknown = node.toJS(doc);
  const json = jsonValue.safeParse(value);

  return json.success && JSON.stringify(json.data) === JSON.stringify(value)
    ? json.data
    : yaml.slice(node.range[0], node.range[1]).trimEnd();
};

const keyValues = (yaml: string) => {
  const doc = parseDocument(yaml);

  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return null;
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
    return null;
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
  front.kind === "fields" ? front.facts : readKeys(new Map()).facts;

export const unheldYaml = (front: Frontmatter) => {
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

    default: {
      throw new Error(`unexpected ${String(front satisfies never)}`);
    }
  }
};

export const titleOf = (facts: FileFacts, name: string) =>
  cut(facts.title ?? name, ITEM_FIELD_CAPS.line) ?? "";

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
