// yaml the typed ADT cannot represent is preserved byte-exactly, never coerced or dropped.

import { isMap, isScalar, parse as parseYaml, parseDocument } from "yaml";
import { z } from "zod";

// yaml 1.2 core has no timestamp tag, so every value is json-shaped; `.nan`/`.inf` fail the
// schema and read as unsupported.
const yamlValue = z.json();
type YamlValue = z.infer<typeof yamlValue>;

const propertiesSchema = z.record(z.string(), yamlValue);
type Properties = z.infer<typeof propertiesSchema>;

export type SplitDoc = {
  properties: Properties;
  body: string;
};

// remark-frontmatter's default `yaml` fence; the content group is optional so an empty block matches.
const FRONTMATTER_RE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

function parseYamlRecord(source: string): Properties {
  try {
    const parsed = propertiesSchema.safeParse(parseYaml(source));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function frontmatterYaml(text: string): string | null {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return null;
  return match[1] ?? "";
}

export function splitFrontmatter(text: string): SplitDoc {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { properties: {}, body: text };
  const body = text.slice(match[0].length);
  return { properties: parseYamlRecord(match[1] ?? ""), body };
}

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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// branch order is the precedence; z.number() already rejects NaN/±Infinity.
function classify(key: string, value: YamlValue, rawYaml: string): TypedProperty {
  const checkbox = z.boolean().safeParse(value);
  if (checkbox.success) return { key, type: "checkbox", value: checkbox.data };
  const number = z.number().safeParse(value);
  if (number.success) return { key, type: "number", value: number.data };
  const text = z.string().safeParse(value);
  if (text.success) {
    const parsed = text.data;
    return DATE_RE.test(parsed)
      ? { key, type: "date", value: parsed }
      : { key, type: "text", value: parsed };
  }
  const tags = z.array(z.string()).safeParse(value);
  if (tags.success) return { key, type: "tags", value: tags.data };
  return { key, type: "unsupported", rawYaml };
}

export function parseProperties(yamlText: string): ParsedProperties {
  if (yamlText.trim() === "") return { kind: "none" };
  let doc;
  try {
    doc = parseDocument(yamlText);
  } catch {
    return { kind: "invalid" };
  }
  // duplicate keys surface as document errors too.
  if (doc.errors.length > 0) return { kind: "invalid" };
  const contents = doc.contents;
  if (!isMap(contents)) return { kind: "invalid" };
  const properties: TypedProperty[] = [];
  for (const item of contents.items) {
    const keyNode = item.key;
    const key = isScalar(keyNode) ? String(keyNode.value) : String(keyNode);
    const valueNode = item.value;
    // range[0..1] is the value span, excluding the key and trailing node gap.
    const range = valueNode?.range;
    const rawYaml = range ? yamlText.slice(range[0], range[1]).trimEnd() : "";
    const value = yamlValue.safeParse(valueNode == null ? null : valueNode.toJSON());
    properties.push(
      value.success ? classify(key, value.data, rawYaml) : { key, type: "unsupported", rawYaml },
    );
  }
  return { kind: "valid", properties };
}

// `alias:` is honored only when it is the doc's only alias list: extraction prefers `aliases`,
// so minting one beside `alias` would shadow the old entries.
export function addFrontmatterAlias(content: string, alias: string): string | null {
  const trimmed = alias.trim();
  if (trimmed === "") return null;
  const yaml = frontmatterYaml(content);
  const parsed = parseProperties(yaml ?? "");
  if (parsed.kind === "invalid") return null;
  const props = parsed.kind === "valid" ? parsed.properties : [];
  const key =
    props.some((p) => p.key === "aliases") || !props.some((p) => p.key === "alias")
      ? "aliases"
      : "alias";
  const existing = props.find((p) => p.key === key);
  if (existing !== undefined && existing.type !== "tags") return null;
  const current = existing === undefined ? [] : existing.value;
  if (current.some((a) => a.trim().toLowerCase() === trimmed.toLowerCase())) return null;
  const nextProps: TypedProperty[] =
    existing === undefined
      ? [...props, { key, type: "tags", value: [trimmed] }]
      : props.map((p): TypedProperty =>
          p.key === key && p.type === "tags"
            ? { key: p.key, type: "tags", value: [...p.value, trimmed] }
            : p,
        );
  const nextYaml = serializeProperties(nextProps, yaml ?? "");
  const body = splitFrontmatter(content).body;
  return `---\n${nextYaml}\n---\n${body}`;
}

export function typeNewProperty(key: string, rawValue: string): TypedProperty {
  if (rawValue.trim() === "") return { key, type: "text", value: "" };
  try {
    const parsed = yamlValue.safeParse(parseYaml(rawValue));
    return parsed.success
      ? classify(key, parsed.data, rawValue)
      : { key, type: "unsupported", rawYaml: rawValue };
  } catch {
    return classify(key, rawValue, rawValue);
  }
}

function typedValue(prop: TypedProperty) {
  return prop.type === "unsupported" ? undefined : prop.value;
}

function valueEqual(a: YamlValue | undefined, b: ReturnType<typeof typedValue>): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return a === b;
}

// edits the Document parsed from `priorRaw` rather than re-stringifying, so untouched keys
// (every `unsupported` one) keep their source bytes, comments included.
export function serializeProperties(properties: TypedProperty[], priorRaw: string): string {
  if (properties.length === 0) return "";
  const doc = parseDocument(priorRaw);
  const priorValues = parseYamlRecord(priorRaw);
  if (isMap(doc.contents)) {
    const desired = new Set(properties.map((prop) => prop.key));
    const removable = doc.contents.items
      .map((item) => (isScalar(item.key) ? String(item.key.value) : String(item.key)))
      .filter((key) => !desired.has(key));
    for (const key of removable) doc.delete(key);
  }
  for (const prop of properties) {
    if (prop.type === "unsupported") continue;
    const next = typedValue(prop);
    const had = Object.prototype.hasOwnProperty.call(priorValues, prop.key);
    if (!had || !valueEqual(priorValues[prop.key], next)) doc.set(prop.key, next);
  }
  // a mapping stringifies with one trailing newline; the frontmatter node value carries none.
  return doc.toString().replace(/\n$/, "");
}
