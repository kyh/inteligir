// Expanded on the template's own bytes: `{{` is the formula grammar, and a placeholder is exactly
// one of three bare spellings, so a pill (`{{a|b}}`) is never touched. The set is closed; a fourth
// spelling is a fourth thing the pill grammar must never mean. The date and the time are fixed ISO
// strings and land as they are; the title is a file name, which can spell anything, so it is
// spelled for where it lands: escaped in prose, a scalar in the frontmatter, and as written
// wherever the bytes are literal or have a grammar of their own (code, math, a wiki link, a url).

import type { Parent, Text } from "mdast";
import type { Handle } from "mdast-util-to-markdown";
import { defaultHandlers, toMarkdown } from "mdast-util-to-markdown";
import { unified } from "unified";
import { CST, Parser, Schema } from "yaml";

import { formatIsoDate, formatIsoTime } from "../iso-date";
import { parseBare } from "../markdown/bare-parse";
import { frontmatterYaml, frontmatterYamlStart } from "../markdown/frontmatter";
import { MD_REMARK_PLUGINS, MD_STRINGIFY } from "../markdown/md-plugins";

interface TemplateContext {
  now: Date;
  title: string;
}

const PLACEHOLDER_RE = /\{\{(?<name>date|time|title)\}\}/gu;
const TITLE = "{{title}}";
const TITLE_RE = /\{\{title\}\}/gu;

// the dialect's stringify half is whatever its plugins register on a processor they attach to
const { toMarkdownExtensions = [] } = unified().use(MD_REMARK_PLUGINS).freeze().data();

// each prose `{{title}}` becomes a text node of its own, keyed by the placeholder's offset
const splitTitles = (
  parent: Parent,
  markdown: string,
  title: string,
  titles: Map<Text, number>,
): void => {
  for (let index = parent.children.length - 1; index >= 0; index -= 1) {
    const child = parent.children[index];
    if (child === undefined) {
      continue;
    }
    if ("children" in child) {
      splitTitles(child, markdown, title, titles);
      continue;
    }
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (child.type !== "text" || start === undefined || end === undefined) {
      continue;
    }
    const offsets = Array.from(
      markdown.slice(start, end).matchAll(TITLE_RE),
      (match) => start + match.index,
    );
    const pieces = child.value.split(TITLE);
    // a placeholder spelled through an escape or a character reference counts on one side only,
    // and keeps the bytes it was written with
    if (offsets.length === 0 || pieces.length !== offsets.length + 1) {
      continue;
    }
    const split: Text[] = [];
    for (const [at, piece] of pieces.entries()) {
      if (piece !== "") {
        split.push({ type: "text", value: piece });
      }
      const offset = offsets[at];
      if (offset !== undefined) {
        const node: Text = { type: "text", value: title };
        titles.set(node, offset);
        split.push(node);
      }
    }
    parent.children.splice(index, 1, ...split);
  }
};

// the serializer's own escape, so the title is spelled as the editor would write it in the
// heading, the table cell or the link label it lands in and beside the characters around it
const proseTitleSpellings = (markdown: string, title: string): Map<number, string> => {
  const spellings = new Map<number, string>();
  const titles = new Map<Text, number>();
  // a peek at the next sibling spells a title early; the pass that writes it comes last and wins
  const text: Handle = (node: Text, parent, state, info) => {
    const spelled = defaultHandlers.text(node, parent, state, info);
    const offset = titles.get(node);
    if (offset !== undefined) {
      spellings.set(offset, spelled);
    }
    return spelled;
  };
  try {
    const root = parseBare(markdown);
    splitTitles(root, markdown, title, titles);
    if (titles.size > 0) {
      toMarkdown(root, {
        ...MD_STRINGIFY,
        extensions: toMarkdownExtensions,
        handlers: { ...MD_STRINGIFY.handlers, text },
      });
    }
  } catch (error) {
    // nested past the serializer's reach: the title lands as written, and the editor refuses
    // the template for its depth anyway
    if (error instanceof RangeError) {
      return new Map();
    }
    throw error;
  }
  return spellings;
};

// setScalarValue checks a plain scalar's syntax but not what the schema reads it as, so a title
// such as `2026` or `true` is quoted the way yaml's own stringify quotes it
const NON_STRING_TAGS = new Schema({}).tags.filter(
  (tag) => tag.default === true && tag.tag !== "tag:yaml.org,2002:str",
);
const readsAsString = (plain: string): boolean =>
  !NON_STRING_TAGS.some((tag) => tag.test?.test(plain) === true);

interface ScalarPlace {
  afterKey?: boolean;
  implicitKey?: boolean;
  inFlow: boolean;
}

const respell = (
  token: CST.Token | null | undefined,
  place: ScalarPlace,
  marker: string,
  title: string,
): void => {
  if (
    token?.type !== "scalar" &&
    token?.type !== "single-quoted-scalar" &&
    token?.type !== "double-quoted-scalar"
  ) {
    return;
  }
  const { value } = CST.resolveAsScalar(token);
  if (!value.includes(marker)) {
    return;
  }
  const titled = value.replaceAll(marker, title);
  const quoted = token.type === "scalar" && !readsAsString(titled);
  CST.setScalarValue(token, titled, quoted ? { ...place, type: "QUOTE_DOUBLE" } : place);
};

// the title enters the yaml as a word of letters, which every scalar style holds unchanged, so
// the parse sees the template's own structure; each scalar holding it is then rewritten by yaml
// with the title in place, and every other byte stays as written
const titleInYaml = (yaml: string, marker: string, title: string): string => {
  const tokens = [...new Parser().parse(yaml)];
  for (const token of tokens) {
    if (token.type !== "document") {
      continue;
    }
    CST.visit(token, (item, path) => {
      const inFlow =
        path.length > 0 && CST.visit.parentCollection(token, path).type === "flow-collection";
      respell(item.key, { implicitKey: true, inFlow }, marker, title);
      respell(item.value, { afterKey: item.key !== undefined, inFlow }, marker, title);
    });
  }
  // left in a comment, a block scalar or yaml that does not parse, the title lands as written
  return tokens
    .map((token) => CST.stringify(token))
    .join("")
    .replaceAll(marker, title);
};

const absentWord = (text: string): string => {
  let word = "templatetitle";
  while (text.includes(word)) {
    word += "x";
  }
  return word;
};

const spellPlaceholders = (
  source: string,
  now: Date,
  spellTitle: (offset: number) => string,
): string =>
  source.replace(PLACEHOLDER_RE, (_match, name: string, offset: number) => {
    if (name === "date") {
      return formatIsoDate(now);
    }
    if (name === "time") {
      return formatIsoTime(now);
    }
    return spellTitle(offset);
  });

export const expandTemplate = (markdown: string, { now, title }: TemplateContext): string => {
  const prose = markdown.includes(TITLE)
    ? proseTitleSpellings(markdown, title)
    : new Map<number, string>();
  const yamlStart = frontmatterYamlStart(markdown);
  const yaml = frontmatterYaml(markdown);
  if (yamlStart === null || yaml === null) {
    return spellPlaceholders(markdown, now, (offset) => prose.get(offset) ?? title);
  }
  const yamlEnd = yamlStart + yaml.length;
  const marker = absentWord(yaml);
  return (
    markdown.slice(0, yamlStart) +
    titleInYaml(
      spellPlaceholders(yaml, now, () => marker),
      marker,
      title,
    ) +
    spellPlaceholders(
      markdown.slice(yamlEnd),
      now,
      (offset) => prose.get(yamlEnd + offset) ?? title,
    )
  );
};
