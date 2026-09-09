import { assetMediaType } from "@repo/api/cloud/vault/vault-schema";
import type { Code, List, Paragraph, PhrasingContent, Root, RootContent } from "mdast";
import { parseCalloutPayload } from "@repo/notes/markdown/callout-payload";
import { splitFrontmatter } from "@repo/notes/markdown/frontmatter";
import { parseMdast } from "@repo/notes/markdown/parse";
import { escapePillPipesInTables } from "@repo/notes/markdown/table-pipes";
import { parseWikiBodyRange } from "@repo/notes/markdown/remark-wiki-link";
import { isCalloutLang, RICH_FENCE_LANGS } from "@repo/notes/markdown/fence-langs";
import { docStem } from "@repo/notes/knowledge/doc-file";

export type InlineSpan =
  | {
      kind: "text";
      text: string;
      bold?: boolean;
      italic?: boolean;
      strike?: boolean;
      code?: boolean;
    }
  | { kind: "wiki-link"; target: string; label: string }
  | { kind: "image-embed"; target: string; label: string }
  | { kind: "formula"; label: string }
  | { kind: "link"; label: string; url: string };

export type NoteBlock =
  | { kind: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; spans: InlineSpan[] }
  | { kind: "paragraph"; spans: InlineSpan[] }
  | { kind: "image"; target: string; label: string }
  | {
      kind: "list-item";
      depth: number;
      ordinal: number | null;
      checked: boolean | null;
      spans: InlineSpan[];
    }
  | { kind: "code"; lang: string | null; text: string }
  | { kind: "callout"; label: string; blocks: NoteBlock[] }
  | { kind: "quote"; blocks: NoteBlock[] }
  | { kind: "divider" }
  | { kind: "unsupported"; label: string }
  | { kind: "raw"; text: string };

export type NoteProjection =
  | { kind: "note"; title: string; blocks: NoteBlock[] }
  | { kind: "raw"; title: string; text: string; reason: string };

const RICH_LABELS = {
  canvas_block: "Canvas",
  chart_block: "Chart",
  html_block: "HTML block",
} satisfies Record<NonNullable<ReturnType<(typeof RICH_FENCE_LANGS)["get"]>>, string>;

// a subset of what the asset route serves, in its media types so a promoted target is one it
// serves: core RN Image cannot draw SVG, and the rarer formats render inconsistently across Fresco
// and UIImage.
const MOBILE_IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const isMobileImageTarget = (target: string): boolean => {
  const mediaType = assetMediaType(target);
  return mediaType !== null && MOBILE_IMAGE_MEDIA_TYPES.has(mediaType);
};

interface SpanStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
}

const spanText = (span: InlineSpan): string => (span.kind === "text" ? span.text : span.label);

type LeafPhrasing = Exclude<PhrasingContent, { type: "strong" | "emphasis" | "delete" | "link" }>;

const wikiSpan = (
  node: Extract<PhrasingContent, { type: "wikiLink" | "wikiEmbed" }>,
): InlineSpan => {
  const body = parseWikiBodyRange(node.body);
  const label =
    body.alias ?? (body.anchor === undefined ? body.target : `${body.target}#${body.anchor}`);
  return node.type === "wikiEmbed" && isMobileImageTarget(body.target)
    ? { kind: "image-embed", label, target: body.target }
    : { kind: "wiki-link", label, target: body.target };
};

const imageAltText = (alt: string | null | undefined): string =>
  alt === null || alt === undefined || alt === "" ? "[image]" : alt;

const projectParsed = (source: string, root: Root): NoteBlock[] => {
  const rawSlice = (node: {
    position?:
      | { start: { offset?: number | undefined }; end: { offset?: number | undefined } }
      | undefined;
  }): string | null => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      return null;
    }
    return source.slice(start, end);
  };

  const inlineLeaf = (node: LeafPhrasing, style: SpanStyle): InlineSpan | null => {
    switch (node.type) {
      case "text": {
        return { kind: "text", text: node.value, ...style };
      }
      case "inlineCode": {
        return { kind: "text", text: node.value, ...style, code: true };
      }
      case "break": {
        return { kind: "text", text: "\n", ...style };
      }
      case "image": {
        return { kind: "text", text: imageAltText(node.alt), ...style };
      }
      case "wikiLink":
      case "wikiEmbed": {
        return wikiSpan(node);
      }
      case "formulaPill": {
        return { kind: "formula", label: node.display === "" ? node.source : node.display };
      }
      case "commentMarker":
      case "html": {
        return null;
      }
      case "footnoteReference":
      case "imageReference":
      case "inlineMath":
      case "linkReference":
      case "mdxJsxTextElement":
      case "mdxTextExpression":
      case "opaqueInline": {
        return { kind: "text", text: rawSlice(node) ?? "", ...style };
      }
      // no default
    }
  };

  const flattenInline = (
    nodes: readonly PhrasingContent[],
    style: SpanStyle = {},
  ): InlineSpan[] => {
    const spans: InlineSpan[] = [];
    for (const node of nodes) {
      if (node.type === "strong") {
        spans.push(...flattenInline(node.children, { ...style, bold: true }));
        continue;
      }
      if (node.type === "emphasis") {
        spans.push(...flattenInline(node.children, { ...style, italic: true }));
        continue;
      }
      if (node.type === "delete") {
        spans.push(...flattenInline(node.children, { ...style, strike: true }));
        continue;
      }
      if (node.type === "link") {
        spans.push({
          kind: "link",
          label: flattenInline(node.children).map(spanText).join("") || node.url,
          url: node.url,
        });
        continue;
      }
      const leaf = inlineLeaf(node, style);
      if (leaf !== null) {
        spans.push(leaf);
      }
    }
    return spans;
  };

  // a callout body is its own document; the parse is re-entered, not the projection
  const projectNested = (body: string): NoteBlock[] => {
    const parsed = parseMdast(body);
    if (!parsed.ok) {
      return [{ kind: "raw", text: body }];
    }
    // the parser positioned nodes against the pipe-escaped text, so raw slices must cut the same
    // bytes.
    return projectParsed(escapePillPipesInTables(body), parsed.root);
  };

  const projectParagraph = (node: Paragraph, blocks: NoteBlock[]): void => {
    const spans = flattenInline(node.children);
    // a paragraph that is only embeds promotes to image blocks: an image inside a Text run
    // cannot be sized.
    const promotes =
      spans.some((span) => span.kind === "image-embed") &&
      spans.every(
        (span) => span.kind === "image-embed" || (span.kind === "text" && span.text.trim() === ""),
      );
    if (!promotes) {
      blocks.push({ kind: "paragraph", spans });
      return;
    }
    for (const span of spans) {
      if (span.kind === "image-embed") {
        blocks.push({ kind: "image", label: span.label, target: span.target });
      }
    }
  };

  const projectCode = (node: Code, blocks: NoteBlock[]): void => {
    const rich = RICH_FENCE_LANGS.get(node.lang ?? "");
    if (rich !== undefined) {
      blocks.push({ kind: "unsupported", label: RICH_LABELS[rich] });
      return;
    }
    if (isCalloutLang(node.lang)) {
      const payload = parseCalloutPayload(node.value);
      if (payload !== null) {
        blocks.push({
          blocks: projectNested(payload.body),
          kind: "callout",
          label: payload.level === undefined ? payload.kind : `${payload.kind} · ${payload.level}`,
        });
        return;
      }
    }
    blocks.push({ kind: "code", lang: node.lang ?? null, text: node.value });
  };

  const projectList = (
    list: List,
    depth: number,
    blocks: NoteBlock[],
    project: (node: RootContent, out: NoteBlock[]) => void,
  ): void => {
    let ordinal = list.ordered === true ? (list.start ?? 1) : null;
    for (const item of list.children) {
      let first = true;
      for (const child of item.children) {
        if (child.type === "paragraph" && first) {
          blocks.push({
            checked: item.checked ?? null,
            depth,
            kind: "list-item",
            ordinal,
            spans: flattenInline(child.children),
          });
          first = false;
        } else if (child.type === "list") {
          projectList(child, depth + 1, blocks, project);
        } else {
          project(child, blocks);
        }
      }
      if (first) {
        blocks.push({
          checked: item.checked ?? null,
          depth,
          kind: "list-item",
          ordinal,
          spans: [],
        });
      }
      if (ordinal !== null) {
        ordinal += 1;
      }
    }
  };

  // every node type this does not name projects as its own raw source: the reader sees the markdown
  // rather than nothing.
  const projectBlock = (node: RootContent, blocks: NoteBlock[]): void => {
    if (node.type === "heading") {
      blocks.push({ depth: node.depth, kind: "heading", spans: flattenInline(node.children) });
      return;
    }
    if (node.type === "paragraph") {
      projectParagraph(node, blocks);
      return;
    }
    if (node.type === "list") {
      projectList(node, 0, blocks, projectBlock);
      return;
    }
    if (node.type === "code") {
      projectCode(node, blocks);
      return;
    }
    if (node.type === "blockquote") {
      const inner: NoteBlock[] = [];
      for (const child of node.children) {
        projectBlock(child, inner);
      }
      blocks.push({ blocks: inner, kind: "quote" });
      return;
    }
    if (node.type === "thematicBreak") {
      blocks.push({ kind: "divider" });
      return;
    }
    if (node.type === "yaml" || node.type === "html") {
      return;
    }
    const raw = rawSlice(node);
    if (raw !== null && raw.trim() !== "") {
      blocks.push({ kind: "raw", text: raw });
    }
  };

  const blocks: NoteBlock[] = [];
  for (const child of root.children) {
    projectBlock(child, blocks);
  }
  return blocks;
};

export const projectNote = (path: string, content: string): NoteProjection => {
  const title = docStem(path);
  const { body } = splitFrontmatter(content);
  const parsed = parseMdast(body);
  if (!parsed.ok) {
    return { kind: "raw", reason: parsed.failure.message, text: content, title };
  }
  return { blocks: projectParsed(escapePillPipesInTables(body), parsed.root), kind: "note", title };
};
