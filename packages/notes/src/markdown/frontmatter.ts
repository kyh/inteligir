// yaml the typed ADT cannot represent is preserved byte-exactly, never coerced or dropped.

import { isMap, isScalar, isSeq, parse as parseYaml, parseDocument } from "yaml";
import { z } from "zod";

// yaml 1.2 core has no timestamp tag, so every value is json-shaped; `.nan`/`.inf` fail the
// schema and read as unsupported.
const yamlValue = z.json();
type YamlValue = z.infer<typeof yamlValue>;

// remark-frontmatter's default `yaml` fence, read past the BOM micromark skips; the content group
// is optional so an empty block matches. `eol` is the opener's terminator, which a rewrite keeps.
const FRONTMATTER_RE =
  /^\uFEFF?---[ \t]*(?<eol>\r?\n)(?:(?<yaml>[\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/u;

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

// yaml 1.2 core schema: `true`/`false` are the only booleans (yes/no/on/off stay text) and
// dates are recognized only from explicit `YYYY-MM-DD` strings.
export type PropertyType = "text" | "number" | "checkbox" | "date" | "tags" | "unsupported";

export type TypedProperty =
  | { key: string; type: "text"; value: string }
  | { key: string; type: "number"; value: number }
  | { key: string; type: "checkbox"; value: boolean }
  | { key: string; type: "date"; value: string }
  | { key: string; type: "tags"; value: string[] }
  | { key: string; type: "unsupported"; raw: string };

// a caller must never rewrite the block on `invalid`.
export type ParsedProperties =
  | { kind: "valid"; properties: TypedProperty[] }
  | { kind: "invalid" }
  | { kind: "none" };

// no month/day range check: an out-of-range date still edits as a date field rather than being reclassified.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

// branch order is the precedence; z.number() already rejects NaN/±Infinity.
const classify = (key: string, value: YamlValue, raw: string): TypedProperty => {
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
  return { key, raw, type: "unsupported" };
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
    const raw = range ? yamlText.slice(range[0], range[1]).trimEnd() : "";
    const value = yamlValue.safeParse(
      valueNode === null || valueNode === undefined ? null : valueNode.toJSON(),
    );
    properties.push(
      value.success ? classify(key, value.data, raw) : { key, raw, type: "unsupported" },
    );
  }
  return { kind: "valid", properties };
};

// the note's identity: frontmatter `id`, the value `[[Title|uuid]]` resolves and the annotation
// store is keyed by. Text only: a number or a list is not a name.
export const noteIdOfProperties = (parsed: ParsedProperties | null): string | null => {
  if (parsed?.kind !== "valid") {
    return null;
  }
  const prop = parsed.properties.find((p) => p.key === "id");
  if (prop?.type !== "text") {
    return null;
  }
  const id = prop.value.trim();
  return id === "" ? null : id;
};

// the key the index reads a note's tags from, beside its inline `#tag`s
export const TAGS_KEY = "tags";

// A list key's string entries: a sequence's string items, or one bare string. Anything else in it
// (a number, a map, a block scalar) is skipped rather than costing the key, so a hand-written
// `[2026, ok]` still yields `ok`. Empty on invalid yaml.
export const yamlStringEntries = (yamlText: string, key: string): string[] => {
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
  const entries: string[] = [];
  for (const node of isSeq(value) ? value.items : [value]) {
    const text = isScalar(node) ? z.string().safeParse(node.value) : null;
    if (text?.success === true) {
      entries.push(text.data);
    }
  }
  return entries;
};

// a spelling yaml reads as something else (`true`, `2026`, `#x`) would change the value's type
const plainReadsAsItself = (value: string): boolean => {
  try {
    return parseYaml(value) === value;
  } catch {
    return false;
  }
};

// a block value (`key: value`), plain when it reads back as itself and double-quoted otherwise
export const yamlScalarText = (value: string): string =>
  plainReadsAsItself(value) ? value : JSON.stringify(value);

export const typeNewProperty = (key: string, rawValue: string): TypedProperty => {
  if (rawValue.trim() === "") {
    return { key, type: "text", value: "" };
  }
  try {
    const parsed = yamlValue.safeParse(parseYaml(rawValue));
    return parsed.success
      ? classify(key, parsed.data, rawValue)
      : { key, raw: rawValue, type: "unsupported" };
  } catch {
    return classify(key, rawValue, rawValue);
  }
};
