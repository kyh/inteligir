// ---------------------------------------------------------------------------
// The delegation anchor's on-disk grammar: an HTML comment alone on its line
// (`<!-- inteligir:thread anc_… -->`) — invisible in any other markdown
// renderer, round-trip-inert, greppable.
//
// RECOGNITION IS SYNTAX-AWARE, and that is the whole point of this module.
// A regex over the raw bytes matches the same characters inside a fenced code
// block, inside `inline code`, and inside a frontmatter string — where they are
// LITERAL TEXT the user wrote, not an anchor. A chip rendered there hides the
// user's text, and a dismiss there deletes it. So a marker is only a marker
// where ../markdown/scan-parse says it is: an `html` node (the parser puts
// fence/inline-code/frontmatter content in `code`/`inlineCode`/`yaml` nodes
// instead, so those can never reach here) that additionally sits alone on its
// line — container prefixes (`>`, indentation) allowed, prose not, because
// `text <!-- … --> text` is a comment inside a sentence, not a block anchor.
//
// INSERTION COMPUTES A LEGAL BLOCK BOUNDARY for the same reason, from the same
// tree. An offset-plus-one-line splice can land inside the frontmatter — which
// makes the YAML invalid, silently changing what `tasks:`, `tags:` and
// `private:` mean — or inside a fence, where the marker becomes code the chip
// then hides. The boundary is the end of the ROOT-LEVEL block containing the
// offset, with one refinement: inside a list, the end of the containing ITEM,
// indented to the item's content column, so a per-task anchor stays with its
// task instead of landing after the whole list. The invariant that makes this
// safe is testable and tested: inserting a marker changes NOTHING about how the
// rest of the document parses.
//
// The file's newline convention is preserved on both ends: a CRLF document gets
// a CRLF-terminated marker, and removal takes the terminator it actually finds.
// ---------------------------------------------------------------------------

import type { Node, Root, RootContent } from "mdast";
import { parseScan } from "./scan-parse";
import { isThreadAnchorToken } from "./thread-anchor";

const MARKER_VALUE_RE = /^<!-- inteligir:thread (anc_[0-9a-f]{12}) -->$/u;

export function threadMarkerText(anchor: string): string {
  if (!isThreadAnchorToken(anchor)) {
    throw new Error(`Not a thread anchor token: ${anchor}`);
  }
  return `<!-- inteligir:thread ${anchor} -->`;
}

export interface ThreadMarker {
  anchor: string;
  /** Offsets of the marker text itself, terminators excluded. */
  from: number;
  to: number;
}

/** The file's newline convention: what a marker inserted into it must use, and
 *  what its removal must consume. CRLF wins when present at all — a mixed file
 *  is already inconsistent, and matching the dominant flavor is what keeps a
 *  Windows checkout's diff to one line. */
function newlineOf(content: string): string {
  if (content.includes("\r\n")) {
    return "\r\n";
  }
  return /\r(?!\n)/u.test(content) ? "\r" : "\n";
}

function lineStartOf(content: string, offset: number): number {
  let start = offset;
  while (start > 0) {
    const previous = content[start - 1];
    if (previous === "\n" || previous === "\r") {
      break;
    }
    start -= 1;
  }
  return start;
}

function lineEndOf(content: string, offset: number): number {
  let end = offset;
  while (end < content.length) {
    const current = content[end];
    if (current === "\n" || current === "\r") {
      break;
    }
    end += 1;
  }
  return end;
}

/** The length of the terminator AT `offset`, 0 when there is none. */
function terminatorLengthAt(content: string, offset: number): number {
  if (content.startsWith("\r\n", offset)) {
    return 2;
  }
  const char = content[offset];
  return char === "\n" || char === "\r" ? 1 : 0;
}

function childrenOf(node: Node): readonly Node[] {
  if (!("children" in node)) {
    return [];
  }
  const { children } = node;
  return Array.isArray(children) ? children : [];
}

function* walk(node: Node): Generator<Node> {
  yield node;
  for (const child of childrenOf(node)) {
    yield* walk(child);
  }
}

/**
 * Every marker in the document, in source order. Syntax-aware: only an `html`
 * node alone on its line counts, so the identical characters inside a fence,
 * inside inline code, inside frontmatter, or mid-sentence are left alone.
 */
export function findThreadMarkers(content: string): ThreadMarker[] {
  const markers: ThreadMarker[] = [];
  for (const node of walk(parseScan(content))) {
    if (node.type !== "html") {
      continue;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      continue;
    }
    const matched = MARKER_VALUE_RE.exec(content.slice(start, end));
    const anchor = matched?.[1];
    if (anchor === undefined) {
      continue;
    }
    // Alone on its line: a container prefix may precede it, prose may not.
    const before = content.slice(lineStartOf(content, start), start);
    const after = content.slice(end, lineEndOf(content, end));
    if (!/^[\s>]*$/u.test(before) || after.trim() !== "") {
      continue;
    }
    markers.push({ anchor, from: start, to: end });
  }
  return markers;
}

export interface ThreadMarkerInsertion {
  /** Offset the text goes in AT — a plain splice; nothing is replaced. */
  at: number;
  text: string;
}

/** The root-level block containing `offset`, or null past the last one. */
function rootBlockAt(tree: Root, offset: number): RootContent | null {
  for (const child of tree.children) {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (start === undefined || end === undefined) {
      continue;
    }
    if (offset >= start && offset <= end) {
      return child;
    }
  }
  return null;
}

/** The list item containing `offset`, with the column its content starts at —
 *  what an anchor must indent to in order to stay inside the item. */
function listItemAt(
  content: string,
  block: RootContent,
  offset: number,
): { end: number; indent: string } | null {
  if (block.type !== "list") {
    return null;
  }
  for (const item of block.children) {
    const start = item.position?.start.offset;
    const end = item.position?.end.offset;
    if (start === undefined || end === undefined) {
      continue;
    }
    if (offset < start || offset > end) {
      continue;
    }
    const firstChild = item.children[0];
    const contentStart = firstChild?.position?.start.offset ?? start;
    const column = contentStart - lineStartOf(content, start);
    return { end, indent: " ".repeat(Math.max(column, 0)) };
  }
  return null;
}

/**
 * Where a marker for the block at `offset` goes: its own line at that block's
 * boundary, never inside frontmatter, a fence, or a list item's continuation.
 * Expressed over the string so the editor buffer and a server-side splice share
 * one rule — the editor dispatches `{from: at, insert: text}`, a string caller
 * splices.
 */
export function threadMarkerInsertion(
  content: string,
  offset: number,
  anchor: string,
): ThreadMarkerInsertion {
  const marker = threadMarkerText(anchor);
  const eol = newlineOf(content);
  const bounded = Math.max(0, Math.min(offset, content.length));
  const block = rootBlockAt(parseScan(content), bounded);
  if (block === null) {
    // Past the last block (or an empty document): append, opening a line only
    // when the file does not already end on one.
    const needsBreak = content.length > 0 && terminatorLengthAt(content, content.length - 1) === 0;
    return { at: content.length, text: `${needsBreak ? eol : ""}${marker}${eol}` };
  }
  const item = listItemAt(content, block, bounded);
  const blockEnd = item?.end ?? block.position?.end.offset ?? content.length;
  // A block's end can sit before its trailing terminator; anchor to the end of
  // the line it lands on so the splice is always at a line boundary.
  const at = lineEndOf(content, blockEnd);
  return { at, text: `${eol}${item?.indent ?? ""}${marker}` };
}

export function insertThreadMarker(content: string, offset: number, anchor: string): string {
  const insertion = threadMarkerInsertion(content, offset, anchor);
  return content.slice(0, insertion.at) + insertion.text + content.slice(insertion.at);
}

export interface ThreadMarkerRemoval {
  from: number;
  to: number;
}

/**
 * The deletion range for a marker: its whole line plus ONE terminator (the one
 * insertion added, whatever flavor it is), so a dismiss reverses an insert
 * byte-exactly instead of leaving a blank line behind. A marker sharing its line
 * with other text loses only the marker's own bytes.
 */
export function threadMarkerRemoval(content: string, marker: ThreadMarker): ThreadMarkerRemoval {
  const lineStart = lineStartOf(content, marker.from);
  const lineEnd = lineEndOf(content, marker.to);
  const alone =
    content.slice(lineStart, marker.from).trim() === "" &&
    content.slice(marker.to, lineEnd).trim() === "";
  if (!alone) {
    return { from: marker.from, to: marker.to };
  }
  if (lineStart > 0) {
    // Take the PRECEDING terminator, which is the one the insertion opened.
    const precedingCrLf = content.startsWith("\r\n", lineStart - 2);
    return { from: lineStart - (precedingCrLf ? 2 : 1), to: lineEnd };
  }
  return { from: lineStart, to: lineEnd + terminatorLengthAt(content, lineEnd) };
}
