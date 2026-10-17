// An item's facts, read from its frontmatter, and the one writer of its keys. YAML-bearing, so
// the server, the projection worker and the phone load it and the contract never does.

import { splitLines } from "../text/source-lines";
import {
  frontmatterYaml,
  noteIdOfProperties,
  parseProperties,
  PINNED_KEY,
  replaceFrontmatterYaml,
  replaceTopLevelKey,
  TAGS_KEY,
  topLevelKeyRange,
  yamlScalarText,
} from "../markdown/frontmatter";
import type { ParsedProperties, TypedProperty } from "../markdown/frontmatter";
import { isItemKind, URL_ITEM_KINDS } from "./item-kind";
import type { ItemKind } from "./item-kind";
import { formatItemTime, parseItemTime } from "./item-time";
import { cleanUrl, isWebUrl, urlHost, urlKey } from "./item-url";

export const ITEM_KEYS = [
  "kind",
  "url",
  "site",
  "author",
  "published",
  "saved",
  "fetched",
  "fetch-error",
  "description",
] as const;
export type ItemKey = (typeof ITEM_KEYS)[number];

// what a fill (and the url-item verdict's winner) owns; `url` and `saved` are written once, at save
export const FILL_OWNED_KEYS = [
  "kind",
  "site",
  "author",
  "published",
  "fetched",
  "fetch-error",
  "description",
] as const satisfies readonly ItemKey[];

export interface ItemFacts {
  kind: ItemKind;
  url: string | null;
  urlKey: string | null;
  host: string | null;
  site: string | null;
  author: string | null;
  published: string | null;
  description: string | null;
  fetchError: string | null;
  savedMs: number | null;
  fetchedMs: number | null;
  // noteIdOfProperties(parsed) !== null
  hasId: boolean;
}

export const NOTE_FACTS: ItemFacts = {
  author: null,
  description: null,
  fetchError: null,
  fetchedMs: null,
  hasId: false,
  host: null,
  kind: "note",
  published: null,
  savedMs: null,
  site: null,
  url: null,
  urlKey: null,
};

const SITE_MAX = 80;
const AUTHOR_MAX = 120;
const PUBLISHED_MAX = 40;

const clip = (text: string, max: number): string => [...text].slice(0, max).join("");

const propertyOf = (
  properties: readonly TypedProperty[],
  key: ItemKey,
): TypedProperty | undefined => properties.find((p) => p.key === key);

// a text or date value, trimmed; "" reads as absent
const textOf = (prop: TypedProperty | undefined): string | null => {
  if (prop === undefined || (prop.type !== "text" && prop.type !== "date")) {
    return null;
  }
  const text = prop.value.trim();
  return text === "" ? null : text;
};

// `[[Steph Ango]]` and `[[people/steph|Steph Ango]]` read as the name they show
const WIKI_NAME = /^\[\[(?:[^|\]]*\|)?(?<name>[^\]]*)\]\]$/u;

const withoutWikiBrackets = (text: string): string =>
  (WIKI_NAME.exec(text.trim())?.groups?.["name"] ?? text).trim();

const authorOf = (prop: TypedProperty | undefined): string | null => {
  if (prop?.type === "tags") {
    const names = prop.value.map(withoutWikiBrackets).filter((name) => name !== "");
    return names.length === 0 ? null : clip(names.join(", "), AUTHOR_MAX);
  }
  const text = textOf(prop);
  if (text === null) {
    return null;
  }
  const name = withoutWikiBrackets(text);
  return name === "" ? null : clip(name, AUTHOR_MAX);
};

// a date or a number is kept as written: `published` is whatever the page said
const publishedOf = (prop: TypedProperty | undefined): string | null => {
  if (prop?.type === "number") {
    return clip(String(prop.value), PUBLISHED_MAX);
  }
  const text = textOf(prop);
  return text === null ? null : clip(text, PUBLISHED_MAX);
};

const timeOf = (prop: TypedProperty | undefined): number | null => {
  const text = textOf(prop);
  return text === null ? null : parseItemTime(text);
};

const kindOf = (prop: TypedProperty | undefined): ItemKind => {
  const text = textOf(prop)?.toLowerCase() ?? "";
  return isItemKind(text) ? text : "note";
};

// what an item's frontmatter says; a block that does not parse, or none, is a plain note
export const readItemFacts = (parsed: ParsedProperties | null): ItemFacts => {
  if (parsed === null || parsed.kind !== "valid") {
    return NOTE_FACTS;
  }
  const { properties } = parsed;
  const rawUrl = textOf(propertyOf(properties, "url"));
  const url = rawUrl !== null && isWebUrl(rawUrl) ? rawUrl : null;
  const site = textOf(propertyOf(properties, "site"));
  return {
    author: authorOf(propertyOf(properties, "author")),
    description: textOf(propertyOf(properties, "description")),
    fetchError: textOf(propertyOf(properties, "fetch-error")),
    fetchedMs: timeOf(propertyOf(properties, "fetched")),
    hasId: noteIdOfProperties(parsed) !== null,
    host: url === null ? null : urlHost(url),
    kind: kindOf(propertyOf(properties, "kind")),
    published: publishedOf(propertyOf(properties, "published")),
    savedMs: timeOf(propertyOf(properties, "saved")),
    site: site === null ? null : clip(site, SITE_MAX),
    url,
    urlKey: url === null ? null : urlKey(url),
  };
};

export const itemFactsOf = (content: string): ItemFacts => {
  const yaml = frontmatterYaml(content);
  return readItemFacts(yaml === null ? null : parseProperties(yaml));
};

// An app-made url item whose page has not been read. It needs the `id` and the `saved` every
// writer stamps (the Mac's save, the phone's share, the import), so a link note an opened folder
// already held, with a `kind: link` and a `url:` of its own, is never filled unasked.
export const isItemStub = (facts: ItemFacts): boolean =>
  URL_ITEM_KINDS.some((kind) => kind === facts.kind) &&
  facts.url !== null &&
  facts.fetchedMs === null &&
  facts.savedMs !== null &&
  facts.hasId;

export type ItemFieldPatch = { readonly [K in ItemKey]?: string | null };

// a block value, plain unless yaml would read it back as something else
const scalar = (value: string): string => yamlScalarText(value, "plain", "block");

const keyLine = (key: string, value: string): string => `${key}: ${scalar(value)}`;

// a note's kind is the absence of the key
const writtenValue = (key: ItemKey, value: string | null | undefined): string | null =>
  value === undefined || value === null || (key === "kind" && value === "note") ? null : value;

// `id`, then ITEM_KEYS in order, then `tags` as a block list, then `pinned`; absent values
// skipped, and a body below a blank line
export type ItemFileFields = ItemFieldPatch & {
  id?: string;
  tags?: readonly string[];
  pinned?: boolean;
};

export const composeItemFile = (fields: ItemFileFields, body: string): string => {
  const lines: string[] = [];
  if (fields.id !== undefined) {
    lines.push(keyLine("id", fields.id));
  }
  for (const key of ITEM_KEYS) {
    const value = writtenValue(key, fields[key]);
    if (value !== null) {
      lines.push(keyLine(key, value));
    }
  }
  const tags = fields.tags ?? [];
  if (tags.length > 0) {
    lines.push(`${TAGS_KEY}:`, ...tags.map((tag) => `  - ${scalar(tag)}`));
  }
  if (fields.pinned === true) {
    lines.push(`${PINNED_KEY}: true`);
  }
  if (lines.length === 0) {
    return body;
  }
  // one blank line under the block, as the editor writes it, so the item is its own fixpoint
  return `---\n${lines.join("\n")}\n---\n${body === "" ? "" : "\n"}${body}`;
};

export type WithItemFieldsVerdict =
  | { kind: "written"; content: string }
  | { kind: "unchanged" }
  // the block does not parse; nothing may rewrite it
  | { kind: "invalid" }
  // a value failed validation
  | { kind: "refused"; key: ItemKey; reason: string };

type Validated = { ok: true; value: string | null } | { ok: false; reason: string };

const validate = (key: ItemKey, value: string | null): Validated => {
  if (value === null) {
    return { ok: true, value: null };
  }
  switch (key) {
    case "kind": {
      const kind = value.trim().toLowerCase();
      if (!isItemKind(kind)) {
        return { ok: false, reason: `${value} is not an item kind` };
      }
      return { ok: true, value: kind === "note" ? null : kind };
    }
    case "url": {
      const url = cleanUrl(value);
      return url === null ? { ok: false, reason: "not a web link" } : { ok: true, value: url };
    }
    case "saved":
    case "fetched": {
      const ms = parseItemTime(value);
      return ms === null
        ? { ok: false, reason: "not an ISO date or time" }
        : { ok: true, value: formatItemTime(ms) };
    }
    default: {
      return { ok: true, value };
    }
  }
};

// where an absent key goes: after the nearest present ITEM_KEYS key before it, else before the
// nearest present one after it, else after `id:`, else first. So a filled stub reads in compose
// order, and two Macs filling one stub write the same bytes.
const insertionIndex = (lines: readonly string[], key: ItemKey): number => {
  const at = ITEM_KEYS.indexOf(key);
  for (const before of ITEM_KEYS.slice(0, at).toReversed()) {
    const range = topLevelKeyRange(lines, before);
    if (range !== null) {
      return range.end;
    }
  }
  for (const after of ITEM_KEYS.slice(at + 1)) {
    const range = topLevelKeyRange(lines, after);
    if (range !== null) {
      return range.start;
    }
  }
  return topLevelKeyRange(lines, "id")?.end ?? 0;
};

// a key already reading as the value (in any spelling) or spelled as its line is left alone
const holdsAlready = (
  current: TypedProperty | undefined,
  lines: readonly string[],
  range: { start: number; end: number },
  line: string,
  value: string,
): boolean =>
  ((current?.type === "text" || current?.type === "date") && current.value === value) ||
  (range.end - range.start === 1 && lines[range.start] === line);

// A line cut: a present key's own lines are replaced and every other byte of the block is left
// alone (its line ending, a BOM, comments, unknown keys, a flow list). `null` removes the key.
export const withItemFields = (content: string, patch: ItemFieldPatch): WithItemFieldsVerdict => {
  const yaml = frontmatterYaml(content);
  const parsed = parseProperties(yaml ?? "");
  if (parsed.kind === "invalid") {
    return { kind: "invalid" };
  }
  const properties = parsed.kind === "valid" ? parsed.properties : [];
  let lines = yaml === null || yaml === "" ? [] : splitLines(yaml);
  let changed = false;
  for (const key of ITEM_KEYS) {
    const raw = patch[key];
    if (raw === undefined) {
      continue;
    }
    const validated = validate(key, raw);
    if (!validated.ok) {
      return { key, kind: "refused", reason: validated.reason };
    }
    const { value } = validated;
    const range = topLevelKeyRange(lines, key);
    if (value === null) {
      if (range !== null) {
        lines = replaceTopLevelKey(lines, key, []);
        changed = true;
      }
      continue;
    }
    const line = keyLine(key, value);
    if (range !== null && holdsAlready(propertyOf(properties, key), lines, range, line, value)) {
      continue;
    }
    if (range === null) {
      const index = insertionIndex(lines, key);
      lines = [...lines.slice(0, index), line, ...lines.slice(index)];
    } else {
      lines = replaceTopLevelKey(lines, key, [line]);
    }
    changed = true;
  }
  if (!changed) {
    return { kind: "unchanged" };
  }
  return { content: replaceFrontmatterYaml(content, lines.join("\n")), kind: "written" };
};
