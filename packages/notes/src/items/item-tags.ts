// The tag line edit `items.tag`, the Info tab's live editor and the url-item verdict share. Each
// edit splices the entries it touches over their own yaml and re-serializes nothing, so a flow
// list stays flow, a CRLF block stays CRLF and every other key keeps its bytes.

import { isMap, isNode, isScalar, isSeq, parseDocument } from "yaml";
import { z } from "zod";
import type { Node as YamlNode, YAMLSeq } from "yaml";

import { scanDoc } from "../knowledge/link-extract";
import {
  frontmatterYaml,
  parseProperties,
  replaceTopLevelKey,
  TAGS_KEY,
  yamlScalarText,
  yamlStringEntries,
} from "../markdown/frontmatter";
import { splitLines } from "../text/source-lines";
import { itemFactsOf, replaceItemYaml } from "./item-frontmatter";

// `#a` and `a` name one tag, in any case
const tagKey = (written: string): string =>
  (written.startsWith("#") ? written.slice(1) : written).trim().toLowerCase();

const linesOf = (yaml: string): string[] => (yaml === "" ? [] : splitLines(yaml));

// the line an offset into the yaml sits on
const lineAt = (yaml: string, offset: number): number =>
  splitLines(yaml.slice(0, offset)).length - 1;

type TagsValue =
  | { kind: "absent" }
  | { kind: "seq"; seq: YAMLSeq<unknown> }
  // a bare string, or nothing under the key
  | { kind: "scalar" }
  // a map or a number: nothing here may guess what it meant
  | { kind: "other" };

const tagsValueOf = (yaml: string): TagsValue => {
  if (yaml.trim() === "") {
    return { kind: "absent" };
  }
  const doc = parseDocument(yaml);
  if (!isMap(doc.contents)) {
    return { kind: "other" };
  }
  const pair = doc.contents.items.find(
    (item) => isScalar(item.key) && String(item.key.value) === TAGS_KEY,
  );
  if (pair === undefined) {
    return { kind: "absent" };
  }
  const { value } = pair;
  if (isSeq(value)) {
    return { kind: "seq", seq: value };
  }
  const isEmpty = value === null || (isScalar(value) && value.value === null);
  const isString = isScalar(value) && yamlStringEntries(yaml, TAGS_KEY).length === 1;
  return isEmpty || isString ? { kind: "scalar" } : { kind: "other" };
};

const blockEntry = (prefix: string, tag: string): string =>
  `${prefix}${yamlScalarText(tag, "plain", "block")}`;

const BLOCK_PREFIX = "  - ";

const nodeRange = (node: YamlNode | null): readonly [number, number] | null => {
  const range = node?.range;
  return range === null || range === undefined ? null : [range[0], range[1]];
};

// a sequence's items as nodes; a pair inside a flow list (`[a: b]`) is not one
const itemNodes = (seq: YAMLSeq<unknown>): (YamlNode | null)[] =>
  seq.items.map((item) => (isNode(item) ? item : null));

const addToFlow = (
  yaml: string,
  seq: YAMLSeq<unknown>,
  missing: readonly string[],
): string | null => {
  const spelled = missing.map((tag) => yamlScalarText(tag, "plain")).join(", ");
  const last = itemNodes(seq).at(-1);
  if (last === undefined) {
    const open = nodeRange(seq);
    return open === null
      ? null
      : `${yaml.slice(0, open[0] + 1)}${spelled}${yaml.slice(open[0] + 1)}`;
  }
  const end = nodeRange(last)?.[1];
  return end === undefined ? null : `${yaml.slice(0, end)}, ${spelled}${yaml.slice(end)}`;
};

const ITEM_PREFIX = /^(?<prefix>[ \t]*-[ \t]+)/u;

const addToBlock = (
  yaml: string,
  seq: YAMLSeq<unknown>,
  missing: readonly string[],
): string | null => {
  const nodes = itemNodes(seq);
  const first = nodeRange(nodes[0] ?? null);
  const last = nodeRange(nodes.at(-1) ?? null);
  if (first === null || last === null) {
    return null;
  }
  const lines = linesOf(yaml);
  const prefix = ITEM_PREFIX.exec(lines[lineAt(yaml, first[0])] ?? "")?.groups?.["prefix"];
  const after = lineAt(yaml, Math.max(last[0], last[1] - 1)) + 1;
  const added = missing.map((tag) => blockEntry(prefix ?? BLOCK_PREFIX, tag));
  return [...lines.slice(0, after), ...added, ...lines.slice(after)].join("\n");
};

// adds each missing tag (case-insensitive) to frontmatter `tags`, creating the key or the block
// as a block list; null when the block does not parse or `tags` holds something not a list
export const addFrontmatterTags = (content: string, tags: readonly string[]): string | null => {
  const yaml = frontmatterYaml(content) ?? "";
  if (parseProperties(yaml).kind === "invalid") {
    return null;
  }
  const held = new Set(yamlStringEntries(yaml, TAGS_KEY).map((entry) => tagKey(entry.value)));
  const missing: string[] = [];
  for (const tag of tags) {
    if (!held.has(tagKey(tag))) {
      held.add(tagKey(tag));
      missing.push(tag);
    }
  }
  if (missing.length === 0) {
    return content;
  }
  const value = tagsValueOf(yaml);
  let next: string | null = null;
  switch (value.kind) {
    case "absent": {
      const added = missing.map((tag) => blockEntry(BLOCK_PREFIX, tag));
      next = [...linesOf(yaml), `${TAGS_KEY}:`, ...added].join("\n");
      break;
    }
    case "seq": {
      next =
        value.seq.flow === true
          ? addToFlow(yaml, value.seq, missing)
          : addToBlock(yaml, value.seq, missing);
      break;
    }
    case "scalar": {
      const kept = yamlStringEntries(yaml, TAGS_KEY).map(
        (entry) => `${BLOCK_PREFIX}${yaml.slice(entry.start, entry.end)}`,
      );
      const added = missing.map((tag) => blockEntry(BLOCK_PREFIX, tag));
      next = replaceTopLevelKey(linesOf(yaml), TAGS_KEY, [`${TAGS_KEY}:`, ...kept, ...added]).join(
        "\n",
      );
      break;
    }
    case "other": {
      break;
    }
    // no default
  }
  return next === null ? null : replaceItemYaml(content, next);
};

// the yaml with the flow list's chosen items cut out, separators with them
const removeFromFlow = (
  yaml: string,
  seq: YAMLSeq<unknown>,
  drop: ReadonlySet<number>,
): string | null => {
  const ranges = itemNodes(seq).map(nodeRange);
  let out = yaml;
  const live = ranges.map((_, i) => i);
  for (const index of [...drop].toSorted((a, b) => b - a)) {
    const at = live.indexOf(index);
    const own = ranges[index];
    if (own === null || own === undefined) {
      return null;
    }
    const next = ranges[live[at + 1] ?? -1];
    const prev = ranges[live[at - 1] ?? -1];
    if (next !== undefined && next !== null) {
      out = `${out.slice(0, own[0])}${out.slice(next[0])}`;
    } else if (prev !== undefined && prev !== null) {
      out = `${out.slice(0, prev[1])}${out.slice(own[1])}`;
    } else {
      return null;
    }
    live.splice(at, 1);
  }
  return out;
};

// the yaml with the block list's chosen items' lines dropped
const removeFromBlock = (
  yaml: string,
  seq: YAMLSeq<unknown>,
  drop: ReadonlySet<number>,
): string | null => {
  const gone = new Set<number>();
  const nodes = itemNodes(seq);
  for (const index of drop) {
    const range = nodeRange(nodes[index] ?? null);
    if (range === null) {
      return null;
    }
    const last = lineAt(yaml, Math.max(range[0], range[1] - 1));
    for (let line = lineAt(yaml, range[0]); line <= last; line += 1) {
      gone.add(line);
    }
  }
  return linesOf(yaml)
    .filter((_, line) => !gone.has(line))
    .join("\n");
};

const withoutTags = (yaml: string, wanted: ReadonlySet<string>): string | null => {
  const value = tagsValueOf(yaml);
  if (value.kind === "scalar") {
    const [entry] = yamlStringEntries(yaml, TAGS_KEY);
    return entry !== undefined && wanted.has(tagKey(entry.value))
      ? replaceTopLevelKey(linesOf(yaml), TAGS_KEY, []).join("\n")
      : yaml;
  }
  if (value.kind !== "seq") {
    return yaml;
  }
  const { items } = value.seq;
  const drop = new Set<number>();
  for (const [index, item] of items.entries()) {
    const text = isScalar(item) ? z.string().safeParse(item.value) : null;
    if (text?.success === true && wanted.has(tagKey(text.data))) {
      drop.add(index);
    }
  }
  if (drop.size === 0) {
    return yaml;
  }
  if (drop.size === items.length) {
    return replaceTopLevelKey(linesOf(yaml), TAGS_KEY, []).join("\n");
  }
  return value.seq.flow === true
    ? removeFromFlow(yaml, value.seq, drop)
    : removeFromBlock(yaml, value.seq, drop);
};

export interface FrontmatterTagRemoval {
  content: string | null;
  inline: string[];
}

// removes the frontmatter entries naming these tags (case-insensitive); `inline` names the ones
// still written as `#tag` in a note's text, which only a text edit removes. `content` is null
// when the block does not parse.
export const removeFrontmatterTags = (
  content: string,
  tags: readonly string[],
): FrontmatterTagRemoval => {
  const yaml = frontmatterYaml(content);
  if (parseProperties(yaml ?? "").kind === "invalid") {
    return { content: null, inline: [] };
  }
  const wanted = new Set(tags.map(tagKey));
  const kept = yaml === null ? "" : withoutTags(yaml, wanted);
  if (kept === null) {
    return { content: null, inline: [] };
  }
  const next = yaml === null || kept === yaml ? content : replaceItemYaml(content, kept);
  // a saved page's hashtags are the page's, not the person's: only a note's count as tags
  const written =
    itemFactsOf(next).kind === "note" ? new Set(scanDoc(next).tags.map(tagKey)) : new Set();
  return { content: next, inline: tags.filter((tag) => written.has(tagKey(tag))) };
};
