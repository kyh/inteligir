import { assetMediaType } from "@repo/api/cloud/vault/vault-schema";
import type { List, PhrasingContent, Root, RootContent } from "mdast";
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

function isMobileImageTarget(target: string): boolean {
  const mediaType = assetMediaType(target);
  return mediaType !== null && MOBILE_IMAGE_MEDIA_TYPES.has(mediaType);
}

type SpanStyle = { bold?: boolean; italic?: boolean; strike?: boolean };

function spanText(span: InlineSpan): string {
  return span.kind === "text" ? span.text : span.label;
}

function projectSource(source: string): NoteBlock[] {
  const parsed = parseMdast(source);
  if (!parsed.ok) {
    return [{ kind: "raw", text: source }];
  }
  // the parser positioned nodes against the pipe-escaped text, so raw slices must cut the same
  // bytes.
  return projectParsed(escapePillPipesInTables(source), parsed.root);
}

function projectParsed(source: string, root: Root): NoteBlock[] {
  function rawSlice(node: {
    position?:
      | { start: { offset?: number | undefined }; end: { offset?: number | undefined } }
      | undefined;
  }): string | null {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return null;
    return source.slice(start, end);
  }

  function flattenInline(nodes: readonly PhrasingContent[], style: SpanStyle = {}): InlineSpan[] {
    const spans: InlineSpan[] = [];
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          spans.push({ kind: "text", text: node.value, ...style });
          break;
        case "strong":
          spans.push(...flattenInline(node.children, { ...style, bold: true }));
          break;
        case "emphasis":
          spans.push(...flattenInline(node.children, { ...style, italic: true }));
          break;
        case "delete":
          spans.push(...flattenInline(node.children, { ...style, strike: true }));
          break;
        case "inlineCode":
          spans.push({ kind: "text", text: node.value, ...style, code: true });
          break;
        case "break":
          spans.push({ kind: "text", text: "\n", ...style });
          break;
        case "link":
          spans.push({
            kind: "link",
            label: flattenInline(node.children).map(spanText).join("") || node.url,
            url: node.url,
          });
          break;
        case "image":
          spans.push({
            kind: "text",
            text:
              node.alt === null || node.alt === undefined || node.alt === "" ? "[image]" : node.alt,
            ...style,
          });
          break;
        case "wikiLink":
        case "wikiEmbed": {
          const body = parseWikiBodyRange(node.body);
          const label =
            body.alias ??
            (body.anchor === undefined ? body.target : `${body.target}#${body.anchor}`);
          spans.push(
            node.type === "wikiEmbed" && isMobileImageTarget(body.target)
              ? { kind: "image-embed", target: body.target, label }
              : { kind: "wiki-link", target: body.target, label },
          );
          break;
        }
        case "formulaPill":
          spans.push({ kind: "formula", label: node.display === "" ? node.source : node.display });
          break;
        case "commentMarker":
          break;
        case "html":
          break;
        default:
          spans.push({ kind: "text", text: rawSlice(node) ?? "", ...style });
      }
    }
    return spans;
  }

  function projectList(list: List, depth: number, blocks: NoteBlock[]): void {
    let ordinal = list.ordered === true ? (list.start ?? 1) : null;
    for (const item of list.children) {
      let first = true;
      for (const child of item.children) {
        if (child.type === "paragraph" && first) {
          blocks.push({
            kind: "list-item",
            depth,
            ordinal,
            checked: item.checked ?? null,
            spans: flattenInline(child.children),
          });
          first = false;
        } else if (child.type === "list") {
          projectList(child, depth + 1, blocks);
        } else {
          projectBlock(child, blocks);
        }
      }
      if (first) {
        blocks.push({
          kind: "list-item",
          depth,
          ordinal,
          checked: item.checked ?? null,
          spans: [],
        });
      }
      if (ordinal !== null) ordinal += 1;
    }
  }

  function projectBlock(node: RootContent, blocks: NoteBlock[]): void {
    switch (node.type) {
      case "heading":
        blocks.push({ kind: "heading", depth: node.depth, spans: flattenInline(node.children) });
        break;
      case "paragraph": {
        const spans = flattenInline(node.children);
        // a paragraph that is only embeds promotes to image blocks: an image inside a Text run
        // cannot be sized.
        const promotes =
          spans.some((span) => span.kind === "image-embed") &&
          spans.every(
            (span) =>
              span.kind === "image-embed" || (span.kind === "text" && span.text.trim() === ""),
          );
        if (promotes) {
          for (const span of spans) {
            if (span.kind === "image-embed") {
              blocks.push({ kind: "image", target: span.target, label: span.label });
            }
          }
          break;
        }
        blocks.push({ kind: "paragraph", spans });
        break;
      }
      case "list":
        projectList(node, 0, blocks);
        break;
      case "code": {
        const rich = RICH_FENCE_LANGS.get(node.lang ?? "");
        if (rich !== undefined) {
          blocks.push({ kind: "unsupported", label: RICH_LABELS[rich] });
          break;
        }
        if (isCalloutLang(node.lang)) {
          const payload = parseCalloutPayload(node.value);
          if (payload !== null) {
            blocks.push({
              kind: "callout",
              label:
                payload.level === undefined ? payload.kind : `${payload.kind} · ${payload.level}`,
              blocks: projectSource(payload.body),
            });
            break;
          }
        }
        blocks.push({ kind: "code", lang: node.lang ?? null, text: node.value });
        break;
      }
      case "blockquote": {
        const inner: NoteBlock[] = [];
        for (const child of node.children) projectBlock(child, inner);
        blocks.push({ kind: "quote", blocks: inner });
        break;
      }
      case "thematicBreak":
        blocks.push({ kind: "divider" });
        break;
      case "yaml":
      case "html":
        break;
      default: {
        const raw = rawSlice(node);
        if (raw !== null && raw.trim() !== "") {
          blocks.push({ kind: "raw", text: raw });
        }
      }
    }
  }

  const blocks: NoteBlock[] = [];
  for (const child of root.children) projectBlock(child, blocks);
  return blocks;
}

export function projectNote(path: string, content: string): NoteProjection {
  const title = docStem(path);
  const { body } = splitFrontmatter(content);
  const parsed = parseMdast(body);
  if (!parsed.ok) {
    return { kind: "raw", title, text: content, reason: parsed.failure.message };
  }
  return { kind: "note", title, blocks: projectParsed(escapePillPipesInTables(body), parsed.root) };
}
