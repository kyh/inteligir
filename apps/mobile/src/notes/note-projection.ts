// The pure half of the mobile note renderer: dialect markdown in, a flat
// typed block list out. The component (markdown-view.tsx) only MAPS blocks to
// RN elements, so everything worth testing lives here, RN-free — the same
// pure-core/thin-shell split the sync store uses.
//
// The parse is the vault's own (`@repo/notes/markdown/parse`) and so is the
// callout header grammar (`callout-payload`); this module never forks the
// dialect. What it decides is PRESENTATION on a phone:
//   • comment markers render as NOTHING — a raw renderer would leak
//     `%%i:…%%` plumbing into prose;
//   • formula pills render their display half (or the source), read-only;
//   • callouts recurse — their body is markdown by the dialect's own rule;
//   • chart/canvas/html payloads and tables answer an honest `unsupported` /
//     `raw` block rather than a lossy imitation;
//   • a file the parse refuses opens RAW, byte-for-byte — the desktop's own
//     posture for a doc it cannot round-trip.

import type { List, PhrasingContent, Root, RootContent } from "mdast";
import { parseCalloutPayload } from "@repo/notes/markdown/callout-payload";
import { splitFrontmatter } from "@repo/notes/markdown/frontmatter";
import { parseMdast } from "@repo/notes/markdown/parse";
import { parseWikiBodyRange } from "@repo/notes/markdown/remark-wiki-link";
import { isCalloutLang, RICH_FENCE_LANGS } from "@repo/notes/markdown/fence-langs";
import { titleFromPath } from "@repo/notes/knowledge/link-extract";

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
  | { kind: "formula"; label: string }
  | { kind: "link"; label: string; url: string };

export type NoteBlock =
  | { kind: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; spans: InlineSpan[] }
  | { kind: "paragraph"; spans: InlineSpan[] }
  | {
      kind: "list-item";
      depth: number;
      /** 1-based ordinal for an ordered item; null for a bullet. */
      ordinal: number | null;
      /** true/false for a task checkbox; null for a plain item. */
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

/** Labels keyed by the fence-langs table's own node types, so a fourth rich
 *  lang is a compile error here rather than a code block on the phone. */
const RICH_LABELS = {
  canvas_block: "Canvas",
  chart_block: "Chart",
  html_block: "HTML block",
} satisfies Record<NonNullable<ReturnType<(typeof RICH_FENCE_LANGS)["get"]>>, string>;

type SpanStyle = { bold?: boolean; italic?: boolean; strike?: boolean };

function spanText(span: InlineSpan): string {
  return span.kind === "text" ? span.text : span.label;
}

/** The callout recursion's entry: a payload that refuses to parse renders raw
 *  INSIDE the card rather than failing the whole note. */
function projectSource(source: string): NoteBlock[] {
  const parsed = parseMdast(source);
  if (!parsed.ok) {
    return [{ kind: "raw", text: source }];
  }
  return projectParsed(source, parsed.root);
}

/** The whole projection closes over `source`, which exactly one leaf reads:
 *  `rawSlice`, the honest fallback for any node this module does not model. */
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
          spans.push({
            kind: "wiki-link",
            target: body.target,
            label:
              body.alias ??
              (body.anchor === undefined ? body.target : `${body.target}#${body.anchor}`),
          });
          break;
        }
        case "formulaPill":
          spans.push({ kind: "formula", label: node.display === "" ? node.source : node.display });
          break;
        case "commentMarker":
          // Review plumbing, never prose.
          break;
        case "html":
          // Inline opaque html (comments included) is plumbing on a phone.
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
        // An item with no paragraph (e.g. only a nested list) still owns a row.
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
      case "paragraph":
        blocks.push({ kind: "paragraph", spans: flattenInline(node.children) });
        break;
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
          // An unknown kind is a plain code block — the dialect's own fallback.
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
        // Frontmatter is folded by the entry point; block html is opaque
        // plumbing (legacy thread markers parse as comments and stay unshown).
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
  const title = titleFromPath(path);
  const { body } = splitFrontmatter(content);
  const parsed = parseMdast(body);
  if (!parsed.ok) {
    return { kind: "raw", title, text: content, reason: parsed.failure.message };
  }
  return { kind: "note", title, blocks: projectParsed(body, parsed.root) };
}
