// An item's fields as the frontmatter of today's vault format: the keys the vault's items carry
// (`@repo/notes/items/item-kind`'s ITEM_KEYS beside `id`, `tags`, `aliases` and `pinned`), the
// cloud's own `title` (only where a file name cannot carry it) and `lang`, and every other key as a
// typed property. A key whose value no field reads stays a property under its own name, so a
// `published: true` or a `kind: book` round-trips; a block that is not YAML at all is no field's,
// and the import keeps it as the note's first code block.

import { parseDocument, stringify } from "yaml";
import { z } from "zod";

import { isItemKind, URL_ITEM_KINDS } from "@repo/notes/items/item-kind";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { readItemFacts } from "@repo/notes/items/item-frontmatter";
import { formatItemTime } from "@repo/notes/items/item-time";
import { frontmatterAliases, frontmatterTags } from "@repo/notes/knowledge/link-extract";
import { ITEM_FIELD_CAPS } from "@repo/notes/library/library-item";
import type { LibraryItemFields, PropertyValue } from "@repo/notes/library/library-item";
import {
  noteIdOfProperties,
  parseProperties,
  yamlScalarText,
} from "@repo/notes/markdown/frontmatter";
import type { ParsedProperties, TypedProperty } from "@repo/notes/markdown/frontmatter";

// the fields a file says: all but where the item sits, which files it holds and whether it is
// deleted, which the import sets from the folder and the body
export type FileFields = Omit<
  LibraryItemFields,
  "copySha" | "coverSha" | "deletedAt" | "folderId" | "originalSha"
>;

export interface FrontmatterRead {
  // the `id:` the file carries, which its highlights' store and a `[[Title|uuid]]` key by
  readonly id: string | null;
  readonly fields: FileFields;
  // a block that is not YAML, as written
  readonly invalidYaml: string | null;
}

// the keys a field reads; any other is a property
const FIELD_KEYS = new Set([
  "aliases",
  "alias",
  "author",
  "description",
  "fetch-error",
  "fetched",
  "id",
  "kind",
  "lang",
  "pinned",
  "published",
  "saved",
  "site",
  "tags",
  "title",
  "url",
]);

const cut = (text: string | null, max: number): string | null => {
  if (text === null) {
    return null;
  }
  const clipped = [...text].slice(0, max).join("").trim();
  return clipped === "" ? null : clipped.slice(0, max);
};

const textProp = (parsed: ParsedProperties, key: string): string | null => {
  if (parsed.kind !== "valid") {
    return null;
  }
  const prop = parsed.properties.find((entry: TypedProperty) => entry.key === key);
  if (prop === undefined || (prop.type !== "text" && prop.type !== "date")) {
    return null;
  }
  return prop.value.trim() === "" ? null : prop.value.trim();
};

const isPinned = (parsed: ParsedProperties): boolean =>
  parsed.kind === "valid" &&
  parsed.properties.some((prop) => prop.key === "pinned" && prop.type === "checkbox" && prop.value);

const uniqueTags = (yaml: string): string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const { tag } of frontmatterTags(yaml)) {
    if (!seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }
  return tags.slice(0, ITEM_FIELD_CAPS.listEntries);
};

const propertyValue = z.json();
const topLevel = z.record(z.string(), z.unknown());

// each top-level key's value as JSON, in the file's order; one YAML cannot spell as JSON (`.nan`)
// keeps its source text
const valuesOf = (yaml: string, parsed: ParsedProperties): Map<string, PropertyValue> => {
  const values = new Map<string, PropertyValue>();
  const doc = topLevel.safeParse(parseDocument(yaml).toJS());
  if (parsed.kind !== "valid" || !doc.success) {
    return values;
  }
  for (const prop of parsed.properties) {
    const json = propertyValue.safeParse(doc.data[prop.key]);
    if (json.success) {
      values.set(prop.key, json.data);
    } else if (prop.type === "unsupported") {
      values.set(prop.key, prop.rawYaml);
    }
  }
  return values;
};

const fetchStateOf = (
  kind: ItemKind,
  url: string | null,
  fetchedAt: number | null,
  fetchError: string | null,
): FileFields["fetchState"] => {
  if (url === null) {
    return "none";
  }
  if (fetchError !== null) {
    return "failed";
  }
  if (fetchedAt !== null) {
    return "filled";
  }
  return URL_ITEM_KINDS.some((urlKind) => urlKind === kind) ? "pending" : "none";
};

const noteFields = (title: string, now: number): FileFields => ({
  aliases: [],
  author: null,
  description: null,
  fetchError: null,
  fetchState: "none",
  fetchedAt: null,
  kind: "note",
  lang: null,
  pinnedAt: null,
  properties: {},
  published: null,
  savedAt: now,
  site: null,
  tags: [],
  title: cut(title, ITEM_FIELD_CAPS.line) ?? "",
  url: null,
});

// a file's frontmatter (its YAML, null for none) as its item's fields; `name` is the file's own
// name, the title unless a `title:` names another
export const readFrontmatter = (
  yaml: string | null,
  name: string,
  now: number,
): FrontmatterRead => {
  const parsed = parseProperties(yaml ?? "");
  if (yaml === null || parsed.kind === "none") {
    return { fields: noteFields(name, now), id: null, invalidYaml: null };
  }
  if (parsed.kind === "invalid") {
    return { fields: noteFields(name, now), id: null, invalidYaml: yaml };
  }
  const facts = readItemFacts(parsed);
  const values = valuesOf(yaml, parsed);
  const url = facts.url !== null && facts.url.length <= ITEM_FIELD_CAPS.url ? facts.url : null;
  const fields: FileFields = {
    aliases: frontmatterAliases(parsed).slice(0, ITEM_FIELD_CAPS.listEntries),
    author: cut(facts.author, ITEM_FIELD_CAPS.line),
    description: cut(facts.description, ITEM_FIELD_CAPS.description),
    fetchError: cut(facts.fetchError, ITEM_FIELD_CAPS.line),
    fetchState: fetchStateOf(facts.kind, url, facts.fetchedMs, facts.fetchError),
    fetchedAt: facts.fetchedMs,
    kind: facts.kind,
    lang: cut(textProp(parsed, "lang"), ITEM_FIELD_CAPS.line),
    pinnedAt: isPinned(parsed) ? (facts.savedMs ?? now) : null,
    properties: {},
    published: cut(facts.published, ITEM_FIELD_CAPS.line),
    savedAt: facts.savedMs ?? now,
    site: cut(facts.site, ITEM_FIELD_CAPS.line),
    tags: uniqueTags(yaml),
    title: cut(textProp(parsed, "title") ?? name, ITEM_FIELD_CAPS.line) ?? "",
    url,
  };
  // a key no field read keeps its value; one a field read is that field's
  const unread = new Set(
    Object.entries({
      author: fields.author === null,
      description: fields.description === null,
      "fetch-error": fields.fetchError === null,
      kind: !isItemKind(textProp(parsed, "kind")?.toLowerCase() ?? "note"),
      lang: fields.lang === null,
      published: fields.published === null,
      site: fields.site === null,
      title: textProp(parsed, "title") === null,
      url: fields.url === null,
    }).flatMap(([key, isUnread]) => (isUnread ? [key] : [])),
  );
  const properties: Record<string, PropertyValue> = {};
  for (const [key, value] of values) {
    if (!FIELD_KEYS.has(key) || unread.has(key)) {
      properties[key] = value;
    }
  }
  return {
    fields: { ...fields, properties },
    id: noteIdOfProperties(parsed),
    invalidYaml: null,
  };
};

const keyLine = (key: string, value: string): string =>
  `${key}: ${yamlScalarText(value, "plain", "block")}`;

const listLines = (key: string, values: readonly string[]): string[] =>
  values.length === 0
    ? []
    : [`${key}:`, ...values.map((value) => `  - ${yamlScalarText(value, "plain", "block")}`)];

// an instant as the vault spells one, its milliseconds kept only when it has any
const instant = (ms: number): string =>
  ms % 1000 === 0 ? formatItemTime(ms) : new Date(ms).toISOString();

// the frontmatter's YAML for an item's fields, its id first, as the vault's writers order their
// keys; `title` is written only when the file's name cannot carry it
export const writeFrontmatter = (fields: FileFields, id: string, title: string | null): string => {
  const lines = [keyLine("id", id)];
  const text = (key: string, value: string | null): void => {
    if (value !== null) {
      lines.push(keyLine(key, value));
    }
  };
  text("title", title);
  text("kind", fields.kind === "note" ? null : fields.kind);
  text("url", fields.url);
  text("site", fields.site);
  text("author", fields.author);
  text("published", fields.published);
  text("saved", instant(fields.savedAt));
  text("fetched", fields.fetchedAt === null ? null : instant(fields.fetchedAt));
  text("fetch-error", fields.fetchError);
  text("description", fields.description);
  text("lang", fields.lang);
  lines.push(...listLines("tags", fields.tags), ...listLines("aliases", fields.aliases));
  if (fields.pinnedAt !== null) {
    lines.push("pinned: true");
  }
  for (const [key, value] of Object.entries(fields.properties)) {
    lines.push(stringify({ [key]: value }).replace(/\n$/u, ""));
  }
  return lines.join("\n");
};
