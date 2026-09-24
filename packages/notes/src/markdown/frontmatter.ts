// yaml the typed ADT cannot represent is preserved byte-exactly, never coerced or dropped.

import { isMap, isScalar, isSeq, parse as parseYaml, parseDocument } from "yaml";
import type { Scalar } from "yaml";
import { z } from "zod";

import { splitLines } from "../knowledge/source-lines";
import { BOM } from "./parsed-offsets";

// yaml 1.2 core has no timestamp tag, so every value is json-shaped; `.nan`/`.inf` fail the
// schema and read as unsupported.
const yamlValue = z.json();
type YamlValue = z.infer<typeof yamlValue>;

const propertiesSchema = z.record(z.string(), yamlValue);
type Properties = z.infer<typeof propertiesSchema>;

export interface SplitDoc {
  properties: Properties;
  body: string;
}

// remark-frontmatter's default `yaml` fence, read past the BOM micromark skips; the content group
// is optional so an empty block matches. `eol` is the opener's terminator, which a rewrite keeps.
const FRONTMATTER_RE =
  /^\uFEFF?---[ \t]*(?<eol>\r?\n)(?:(?<yaml>[\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/u;

const parseYamlRecord = (source: string): Properties => {
  try {
    const parsed = propertiesSchema.safeParse(parseYaml(source));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
};

export const frontmatterYaml = (text: string): string | null => {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) {
    return null;
  }
  return match.groups?.yaml ?? "";
};

// the offset the block ends at, its BOM included: where a reader that withholds the header cuts.
export const frontmatterEnd = (text: string): number | null =>
  FRONTMATTER_RE.exec(text)?.[0].length ?? null;

// where frontmatterYaml's text starts in the note, one past the opener's line break: a splice
// inside the yaml lands at this plus its own offset, and every other byte stays put.
export const frontmatterYamlStart = (text: string): number | null => {
  const match = FRONTMATTER_RE.exec(text);
  return match === null ? null : match[0].indexOf("\n") + 1;
};

export const splitFrontmatter = (text: string): SplitDoc => {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) {
    return { body: text, properties: {} };
  }
  const body = text.slice(match[0].length);
  return { body, properties: parseYamlRecord(match.groups?.yaml ?? "") };
};

// The one recomposition every key edit runs: the BOM and the note's line ending survive, the
// body is sliced rather than re-read, and yaml with nothing in it drops the block. A note with
// no block yet takes the ending of its first line.
export const replaceFrontmatterYaml = (content: string, yaml: string): string => {
  const match = FRONTMATTER_RE.exec(content);
  const bom = content.startsWith(BOM) ? BOM : "";
  const body = match ? content.slice(match[0].length) : content.slice(bom.length);
  if (yaml.trim() === "") {
    return bom + body;
  }
  const eol = match?.groups?.eol ?? /\r?\n/u.exec(content)?.[0] ?? "\n";
  return `${bom}---${eol}${splitLines(yaml).join(eol)}${eol}---${eol}${body}`;
};

// yaml 1.2 core schema: `true`/`false` are the only booleans (yes/no/on/off stay text) and
// dates are recognized only from explicit `YYYY-MM-DD` strings.
export type PropertyType = "text" | "number" | "checkbox" | "date" | "tags" | "unsupported";

export type TypedProperty =
  | { key: string; type: "text"; value: string }
  | { key: string; type: "number"; value: number }
  | { key: string; type: "checkbox"; value: boolean }
  | { key: string; type: "date"; value: string }
  | { key: string; type: "tags"; value: string[] }
  | { key: string; type: "unsupported"; rawYaml: string };

// a caller must never rewrite the block on `invalid`.
export type ParsedProperties =
  | { kind: "valid"; properties: TypedProperty[] }
  | { kind: "invalid" }
  | { kind: "none" };

// no month/day range check: an out-of-range date still edits as a date field rather than being reclassified.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

// branch order is the precedence; z.number() already rejects NaN/±Infinity.
const classify = (key: string, value: YamlValue, rawYaml: string): TypedProperty => {
  const checkbox = z.boolean().safeParse(value);
  if (checkbox.success) {
    return { key, type: "checkbox", value: checkbox.data };
  }
  const number = z.number().safeParse(value);
  if (number.success) {
    return { key, type: "number", value: number.data };
  }
  const text = z.string().safeParse(value);
  if (text.success) {
    const parsed = text.data;
    return DATE_RE.test(parsed)
      ? { key, type: "date", value: parsed }
      : { key, type: "text", value: parsed };
  }
  const tags = z.array(z.string()).safeParse(value);
  if (tags.success) {
    return { key, type: "tags", value: tags.data };
  }
  return { key, rawYaml, type: "unsupported" };
};

export const parseProperties = (yamlText: string): ParsedProperties => {
  if (yamlText.trim() === "") {
    return { kind: "none" };
  }
  let doc;
  try {
    doc = parseDocument(yamlText);
  } catch {
    return { kind: "invalid" };
  }
  // duplicate keys surface as document errors too.
  if (doc.errors.length > 0) {
    return { kind: "invalid" };
  }
  const { contents } = doc;
  if (!isMap(contents)) {
    return { kind: "invalid" };
  }
  const properties: TypedProperty[] = [];
  for (const item of contents.items) {
    const keyNode = item.key;
    const key = isScalar(keyNode) ? String(keyNode.value) : String(keyNode);
    const valueNode = item.value;
    // range[0..1] is the value span, excluding the key and trailing node gap.
    const range = valueNode?.range;
    const rawYaml = range ? yamlText.slice(range[0], range[1]).trimEnd() : "";
    const value = yamlValue.safeParse(
      valueNode === null || valueNode === undefined ? null : valueNode.toJSON(),
    );
    properties.push(
      value.success ? classify(key, value.data, rawYaml) : { key, rawYaml, type: "unsupported" },
    );
  }
  return { kind: "valid", properties };
};

// A line cut, not a re-serialization: serializeProperties restyles what it re-emits (a flow
// list's spacing), and a key edit must leave the other keys byte-exact. The key's own lines are
// its `key:` line and the indented or `- ` lines that continue a block value under it. The key
// may be quoted: the parse reads `"id":` as `id` too.
const withoutTopLevelKey = (lines: readonly string[], key: string): string[] => {
  const keyLine = new RegExp(`^(?:${key}|"${key}"|'${key}')[ \\t]*:`, "u");
  const kept: string[] = [];
  let inValue = false;
  for (const line of lines) {
    if (keyLine.test(line)) {
      inValue = true;
      continue;
    }
    if (inValue && /^[ \t-]/u.test(line)) {
      continue;
    }
    inValue = false;
    kept.push(line);
  }
  return kept;
};

// the note's identity: frontmatter `id`, the value `[[Title|uuid]]` resolves and the comment
// store is keyed by. Text only: a number or a list is not a name.
export const noteIdOfProperties = (parsed: ParsedProperties | null): string | null => {
  if (parsed === null || parsed.kind !== "valid") {
    return null;
  }
  const prop = parsed.properties.find((p) => p.key === "id");
  if (prop === undefined || prop.type !== "text") {
    return null;
  }
  const id = prop.value.trim();
  return id === "" ? null : id;
};

export const frontmatterId = (content: string): string | null =>
  noteIdOfProperties(parseProperties(frontmatterYaml(content) ?? ""));

// uuid-shaped, the form the resolver's id tier already answers
export const mintNoteId = (): string => globalThis.crypto.randomUUID();

// `invalid`: the frontmatter is not valid YAML, and nothing here may rewrite bytes it cannot
// read. `foreign-id`: the note carries an `id` that is not text (a number, a date, a list);
// someone may resolve by it, so it is reported rather than overwritten. `value` is how it reads.
export type FrontmatterIdVerdict =
  | { kind: "unchanged"; id: string }
  | { kind: "written"; content: string }
  | { kind: "invalid" }
  | { kind: "foreign-id"; value: string };

export type FrontmatterIdYamlVerdict =
  | Exclude<FrontmatterIdVerdict, { kind: "written" }>
  | { kind: "written"; yaml: string };

// YAML 1.2 core's null spellings: `id:` and `id: ~` hold nothing a minted id could displace
const YAML_NULL_RE = /^(?:~|null|Null|NULL)?$/u;

const holdsNoValue = (prop: TypedProperty): boolean =>
  (prop.type === "text" && prop.value.trim() === "") ||
  (prop.type === "unsupported" && YAML_NULL_RE.test(prop.rawYaml.trim()));

// A line cut like the pin's: `id:` goes first, an empty one is replaced, a note that has one
// keeps it. Over the block's own YAML, the form the live editor's frontmatter node holds.
export const frontmatterYamlWithId = (
  yaml: string | null,
  id: string,
): FrontmatterIdYamlVerdict => {
  const parsed = parseProperties(yaml ?? "");
  if (parsed.kind === "invalid") {
    return { kind: "invalid" };
  }
  const kept = noteIdOfProperties(parsed);
  if (kept !== null) {
    return { id: kept, kind: "unchanged" };
  }
  const existing =
    parsed.kind === "valid" ? parsed.properties.find((p) => p.key === "id") : undefined;
  if (existing !== undefined && !holdsNoValue(existing)) {
    return {
      kind: "foreign-id",
      value: existing.type === "unsupported" ? existing.rawYaml : JSON.stringify(existing.value),
    };
  }
  const lines = yaml === null || yaml === "" ? [] : splitLines(yaml);
  return { kind: "written", yaml: [`id: ${id}`, ...withoutTopLevelKey(lines, "id")].join("\n") };
};

export const withFrontmatterId = (content: string, id: string): FrontmatterIdVerdict => {
  const verdict = frontmatterYamlWithId(frontmatterYaml(content), id);
  return verdict.kind === "written"
    ? { content: replaceFrontmatterYaml(content, verdict.yaml), kind: "written" }
    : verdict;
};

// a note minted from a template must not inherit the template's identity: two notes with one
// `id:` make the `[[Title|uuid]]` tier ambiguous.
export const removeFrontmatterId = (content: string): string => {
  const yaml = frontmatterYaml(content);
  if (yaml === null) {
    return content;
  }
  const lines = splitLines(yaml);
  const kept = withoutTopLevelKey(lines, "id");
  return kept.length === lines.length ? content : replaceFrontmatterYaml(content, kept.join("\n"));
};

const typedValue = (prop: TypedProperty) => (prop.type === "unsupported" ? undefined : prop.value);

const valueEqual = (a: YamlValue | undefined, b: ReturnType<typeof typedValue>): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return a === b;
};

// edits the Document parsed from `priorRaw` rather than re-stringifying, so untouched keys
// (every `unsupported` one) keep their source bytes, comments included.
export const serializeProperties = (properties: TypedProperty[], priorRaw: string): string => {
  if (properties.length === 0) {
    return "";
  }
  const doc = parseDocument(priorRaw);
  const priorValues = parseYamlRecord(priorRaw);
  if (isMap(doc.contents)) {
    const desired = new Set(properties.map((prop) => prop.key));
    const removable = doc.contents.items
      .map((item) => (isScalar(item.key) ? String(item.key.value) : String(item.key)))
      .filter((key) => !desired.has(key));
    for (const key of removable) {
      doc.delete(key);
    }
  }
  for (const prop of properties) {
    if (prop.type === "unsupported") {
      continue;
    }
    const next = typedValue(prop);
    const had = Object.hasOwn(priorValues, prop.key);
    if (!had || !valueEqual(priorValues[prop.key], next)) {
      doc.set(prop.key, next);
    }
  }
  // a mapping stringifies with one trailing newline; the frontmatter node value carries none.
  return doc.toString().replace(/\n$/u, "");
};

// `alias:` is honored only when it is the doc's only alias list: extraction prefers `aliases`,
// so minting one beside `alias` would shadow the old entries.
export const addFrontmatterAlias = (content: string, alias: string): string | null => {
  const trimmed = alias.trim();
  if (trimmed === "") {
    return null;
  }
  const yaml = frontmatterYaml(content);
  const parsed = parseProperties(yaml ?? "");
  if (parsed.kind === "invalid") {
    return null;
  }
  const props = parsed.kind === "valid" ? parsed.properties : [];
  const key =
    props.some((p) => p.key === "aliases") || !props.some((p) => p.key === "alias")
      ? "aliases"
      : "alias";
  const existing = props.find((p) => p.key === key);
  if (existing !== undefined && existing.type !== "tags") {
    return null;
  }
  const current = existing === undefined ? [] : existing.value;
  if (current.some((a) => a.trim().toLowerCase() === trimmed.toLowerCase())) {
    return null;
  }
  const nextProps: TypedProperty[] =
    existing === undefined
      ? [...props, { key, type: "tags", value: [trimmed] }]
      : props.map((p): TypedProperty =>
          p.key === key && p.type === "tags"
            ? { key: p.key, type: "tags", value: [...p.value, trimmed] }
            : p,
        );
  return replaceFrontmatterYaml(content, serializeProperties(nextProps, yaml ?? ""));
};

export const PINNED_KEY = "pinned";

// the key the index reads a note's tags from, beside its inline `#tag`s
export const TAGS_KEY = "tags";

type YamlScalarStyle = "plain" | "single" | "double";

export interface YamlStringEntry {
  value: string;
  // offsets into the yaml text, a quoted scalar's quotes included
  start: number;
  end: number;
  style: YamlScalarStyle;
}

const scalarStyle = (type: Scalar.Type | undefined): YamlScalarStyle | null => {
  switch (type) {
    case "PLAIN": {
      return "plain";
    }
    case "QUOTE_SINGLE": {
      return "single";
    }
    case "QUOTE_DOUBLE": {
      return "double";
    }
    default: {
      return null;
    }
  }
};

// A list key's string entries and where each sits: a sequence's string items, or one bare string.
// Anything else in it (a number, a map, a block scalar) is skipped rather than costing the key, so
// a hand-written `[2026, ok]` still yields `ok`. Empty on invalid yaml, which nothing may rewrite.
export const yamlStringEntries = (yamlText: string, key: string): YamlStringEntry[] => {
  if (yamlText.trim() === "") {
    return [];
  }
  let doc;
  try {
    doc = parseDocument(yamlText);
  } catch {
    return [];
  }
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return [];
  }
  const value = doc.contents.items.find(
    (item) => isScalar(item.key) && String(item.key.value) === key,
  )?.value;
  const entries: YamlStringEntry[] = [];
  for (const node of isSeq(value) ? value.items : [value]) {
    if (!isScalar(node) || !node.range) {
      continue;
    }
    const text = z.string().safeParse(node.value);
    const style = scalarStyle(node.type);
    if (text.success && style !== null) {
      entries.push({ end: node.range[1], start: node.range[0], style, value: text.data });
    }
  }
  return entries;
};

// a flow indicator would split a flow list, and a spelling yaml reads as something else (`true`,
// `2026`, `#x`) would change the value's type
const plainReadsAsItself = (value: string): boolean => {
  if (/[,[\]{}]/u.test(value)) {
    return false;
  }
  try {
    return parseYaml(value) === value;
  } catch {
    return false;
  }
};

// a value spelled in the style its scalar was written in, so a splice restyles nothing; a plain
// scalar that cannot hold it plainly is double-quoted instead.
export const yamlScalarText = (value: string, style: YamlScalarStyle): string => {
  if (style === "single") {
    return `'${value.replaceAll("'", "''")}'`;
  }
  if (style === "plain" && plainReadsAsItself(value)) {
    return value;
  }
  return JSON.stringify(value);
};

export type PinnedYamlVerdict =
  | { kind: "unchanged" }
  | { kind: "invalid" }
  | { kind: "changed"; yaml: string };

// A pin is a frontmatter key, so it travels with the file. Unpinning removes the key rather than
// writing `false`, and a block that empties goes with it ("" is the caller's cue to drop it).
export const pinnedFrontmatterYaml = (yaml: string | null, pinned: boolean): PinnedYamlVerdict => {
  const parsed = parseProperties(yaml ?? "");
  if (parsed.kind === "invalid") {
    return { kind: "invalid" };
  }
  const props = parsed.kind === "valid" ? parsed.properties : [];
  const current = props.find((p) => p.key === PINNED_KEY);
  const isPinned = current !== undefined && current.type === "checkbox" && current.value;
  if (isPinned === pinned) {
    return { kind: "unchanged" };
  }
  const lines = yaml === null || yaml === "" ? [] : splitLines(yaml);
  const kept = withoutTopLevelKey(lines, PINNED_KEY);
  const next = pinned ? [...kept, `${PINNED_KEY}: true`] : kept;
  return { kind: "changed", yaml: next.every((line) => line.trim() === "") ? "" : next.join("\n") };
};

// null: the frontmatter is not valid YAML, and nothing here may rewrite bytes it cannot read.
export const setFrontmatterPinned = (content: string, pinned: boolean): string | null => {
  const verdict = pinnedFrontmatterYaml(frontmatterYaml(content), pinned);
  if (verdict.kind === "invalid") {
    return null;
  }
  if (verdict.kind === "unchanged") {
    return content;
  }
  return replaceFrontmatterYaml(content, verdict.yaml);
};

export const typeNewProperty = (key: string, rawValue: string): TypedProperty => {
  if (rawValue.trim() === "") {
    return { key, type: "text", value: "" };
  }
  try {
    const parsed = yamlValue.safeParse(parseYaml(rawValue));
    return parsed.success
      ? classify(key, parsed.data, rawValue)
      : { key, rawYaml: rawValue, type: "unsupported" };
  } catch {
    return classify(key, rawValue, rawValue);
  }
};
