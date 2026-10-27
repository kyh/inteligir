// An agent's edit to an item, made on its view (`item-view.ts`) and landed as block ops. Each
// `old_text` must stand exactly once in the view as the edits before it left it; the blocks the
// edited text touches (a list whole) are read again from the new text and no others, so every
// other block keeps its id, its place and its highlights' markers. The blocks read again keep the
// ids of the old ones they line up with (unchanged ones change nothing), a marker the new text no
// longer holds is named in the answer, and a link the agent kept or wrote by title still names
// its item. A highlight placed away from the editor (`placeQuotes`) lands the same way.

import type { TElement } from "platejs";

import { placeQuotes } from "@repo/notes/annotations/place-quotes";
import type { PendingQuote } from "@repo/notes/annotations/place-quotes";
import type { FileKind } from "@repo/notes/items/item-kind";
import type { LibraryOp, StoredBlock } from "@repo/notes/library/block-ops";
import { ordsBetween } from "@repo/notes/library/block-order";
import { canonicalJson } from "@repo/notes/library/canonical-json";
import type { LibraryBlock, LibraryNode, LibrarySection } from "@repo/notes/library/library-nodes";
import type { FlowSpan } from "@repo/notes/markdown/flow-spans";
import { parseMdast } from "@repo/notes/markdown/parse";
import { isUuidWikiAlias } from "@repo/notes/markdown/remark-wiki-link";
import type { WikiBody } from "@repo/notes/markdown/remark-wiki-link";
import { diffLines } from "@repo/notes/text/line-diff";

import { headlessEditor } from "@repo/editor/markdown/markdown-doc";
import { rootToSlate } from "@repo/editor/markdown/md-to-slate";

import { itemView, viewFileAt } from "./item-view";
import type { ItemView, ViewBlock, ViewPorts } from "./item-view";
import { nameDrafts } from "./name-blocks";
import type { RefusedBlock } from "./name-blocks";
import { readBlocks } from "./read-blocks";
import type { LibraryFile, ReadHighlight, ReadPorts, Reached } from "./read-blocks";
import { elementsOf, embedFiles, settled } from "./read-markdown";

export interface ViewEdit {
  readonly oldText: string;
  readonly newText: string;
}

export interface EditPorts extends ViewPorts {
  // the item a title names when exactly one does: what a link the agent wrote by title reaches
  readonly itemByTitle: (title: string) => string | null;
  // what kind of file the library holds under a sha; null for bytes it does not hold
  readonly fileKind: (sha: string) => FileKind | null;
  readonly newBlockId: () => string;
  readonly newAnnotationId: () => string;
}

export type EditRefusal =
  // an `old_text` that is empty, stands nowhere, or stands more than once
  | { readonly kind: "empty"; readonly edit: number }
  | { readonly kind: "missing"; readonly edit: number }
  | { readonly kind: "ambiguous"; readonly edit: number; readonly count: number }
  // one that reaches the lines the article section opens and closes on
  | { readonly kind: "section"; readonly edit: number };

export interface ViewChange {
  readonly kind: "changed";
  readonly ops: readonly LibraryOp[];
  // highlights the edit took the markers of out of the text, by id
  readonly dropped: readonly string[];
  // bare highlights an `==x==` in the new text made, for the caller to store
  readonly highlights: readonly ReadHighlight[];
  // what the new text held that no block can store
  readonly refused: readonly RefusedBlock[];
}

export type EditOutcome = ViewChange | { readonly kind: "refused"; readonly refusal: EditRefusal };

// a stretch of the view's text: the blocks one group wrote or the lines between two groups, each
// in its section, or one of the lines the article section opens and closes on, which an edit
// may move but never change
interface Stretch {
  readonly kind: "blocks" | "gap";
  readonly text: string;
  readonly blocks: readonly ViewBlock[];
  readonly section: LibrarySection;
  readonly dirty: boolean;
}

interface SectionLine {
  readonly kind: "line";
  readonly text: string;
  // the section the text before the line reads in, and after it (nothing follows the close)
  readonly before: LibrarySection;
  readonly after: LibrarySection | null;
}

type Piece = Stretch | SectionLine;

const isStretch = (piece: Piece): piece is Stretch => piece.kind !== "line";

const piecesOf = (view: ItemView): Piece[] => {
  const pieces: Piece[] = [];
  let cursor = 0;
  let section: LibrarySection = "note";
  const lines = (to: number): void => {
    if (to <= cursor) {
      return;
    }
    const text = view.markdown.slice(cursor, to);
    const holds = (line: FlowSpan): boolean => line.start >= cursor && line.end <= to;
    if (view.article !== null && holds(view.article.open)) {
      pieces.push({ after: "article", before: "note", kind: "line", text });
    } else if (view.article !== null && holds(view.article.close)) {
      pieces.push({ after: null, before: "article", kind: "line", text });
    } else {
      pieces.push({ blocks: [], dirty: false, kind: "gap", section, text });
    }
    cursor = to;
  };
  const groups = new Map<number, ViewBlock[]>();
  for (const block of view.blocks) {
    groups.set(block.group, [...(groups.get(block.group) ?? []), block]);
  }
  for (const blocks of groups.values()) {
    const [first] = blocks;
    if (first === undefined) {
      continue;
    }
    lines(first.start);
    ({ section } = first);
    pieces.push({
      blocks,
      dirty: false,
      kind: "blocks",
      section,
      text: view.markdown.slice(first.start, first.end),
    });
    cursor = first.end;
  }
  lines(view.markdown.length);
  return pieces;
};

const occurrences = (text: string, needle: string): number[] => {
  const found: number[] = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
};

interface Range {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

// the edited text of a run of pieces cut at each section line it still holds once, each stretch
// between two lines one dirty piece in its own section; null when a line changed or text was
// written after the article's close
const cutAtLines = (run: readonly Piece[], text: string): Piece[] | null => {
  const out: Piece[] = [];
  let cursor = 0;
  let blocks: ViewBlock[] = [];
  let section = run.find(isStretch)?.section ?? "note";
  const stretch = (to: number, at: LibrarySection | null): boolean => {
    const part = text.slice(cursor, to);
    if (part === "" && blocks.length === 0) {
      return true;
    }
    if (at === null) {
      return false;
    }
    out.push({ blocks, dirty: true, kind: "blocks", section: at, text: part });
    blocks = [];
    return true;
  };
  for (const piece of run) {
    if (isStretch(piece)) {
      blocks.push(...piece.blocks);
      continue;
    }
    const at = text.indexOf(piece.text, cursor);
    if (at === -1 || occurrences(text, piece.text).length !== 1 || !stretch(at, piece.before)) {
      return null;
    }
    out.push(piece);
    cursor = at + piece.text.length;
    if (piece.after === null) {
      return stretch(text.length, null) ? out : null;
    }
    section = piece.after;
  }
  return stretch(text.length, section) ? out : null;
};

// one range of the current text replaced: the pieces it touches, and a block on either side of
// the lines it starts or ends in, read again as one; null when it changes a section line
const replaceRange = (pieces: readonly Piece[], range: Range): Piece[] | null => {
  let at = 0;
  const spans = pieces.map((piece) => {
    const span = { end: at + piece.text.length, start: at };
    at = span.end;
    return span;
  });
  const touched = pieces.flatMap((piece, index) => {
    const span = spans[index] ?? { end: 0, start: 0 };
    const touches =
      piece.kind === "blocks"
        ? span.start <= range.end && span.end >= range.start
        : span.start < range.end && span.end > range.start;
    return touches ? [index] : [];
  });
  let first = touched[0] ?? 0;
  let last = touched.at(-1) ?? first;
  if (pieces[first]?.kind !== "blocks" && pieces[first - 1]?.kind === "blocks") {
    first -= 1;
  }
  if (pieces[last]?.kind !== "blocks" && pieces[last + 1]?.kind === "blocks") {
    last += 1;
  }
  const from = spans[first]?.start ?? 0;
  const run = pieces.slice(first, last + 1);
  const whole = run.map((piece) => piece.text).join("");
  const text = whole.slice(0, range.start - from) + range.text + whole.slice(range.end - from);
  const cut = cutAtLines(run, text);
  return cut === null ? null : [...pieces.slice(0, first), ...cut, ...pieces.slice(last + 1)];
};

// what a link the agent kept or wrote names: the id after its last pipe, the item (or the
// nothing) the same link named before the edit, or the one item its title names
const readPortsFor = (replaced: readonly ViewBlock[], ports: EditPorts): ReadPorts => {
  const before = new Map<string, string | null>();
  const ids = new Set<string>();
  const visit = (node: LibraryNode): void => {
    if ("text" in node) {
      return;
    }
    if (node.type === "wikiLink") {
      const title = (node.itemId === null ? null : ports.title(node.itemId)) ?? node.title;
      before.set(
        `${title}\n${node.heading ?? node.blockRef ?? ""}\n${node.alias ?? ""}`,
        node.itemId,
      );
      if (node.itemId !== null) {
        ids.add(node.itemId);
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const { block } of replaced) {
    visit(block);
  }
  const itemReached = (itemId: string | null, fallback: string): Reached =>
    itemId === null ? null : { itemId, kind: "item", title: ports.title(itemId) ?? fallback };
  const wiki = (link: WikiBody): Reached => {
    const byId = link.alias !== undefined && isUuidWikiAlias(link.alias) ? link.alias : null;
    if (byId !== null && (ids.has(byId) || ports.title(byId) !== null)) {
      return itemReached(byId, link.target);
    }
    const anchor = link.anchor?.replace(/^\^/u, "") ?? "";
    const key = `${link.target}\n${anchor}\n${byId === null ? (link.alias ?? "") : ""}`;
    return before.has(key)
      ? itemReached(before.get(key) ?? null, link.target)
      : itemReached(ports.itemByTitle(link.target), link.target);
  };
  const image = (url: string): LibraryFile | null => {
    const file = viewFileAt(url);
    const kind = file === null ? null : ports.fileKind(file.sha);
    return file === null || kind === null
      ? null
      : { kind, name: file.name ?? file.sha, path: url, sha: file.sha };
  };
  return { image, wiki };
};

const markerIds = (blocks: readonly LibraryBlock[]): Set<string> => {
  const ids = new Set<string>();
  const visit = (node: LibraryNode): void => {
    if ("text" in node) {
      return;
    }
    if (node.type === "annotationMarker") {
      for (const id of node.ids.split(",")) {
        ids.add(id);
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const block of blocks) {
    visit(block);
  }
  return ids;
};

const contentKey = (block: LibraryBlock): string => {
  const { id: _id, ...content } = block;
  return canonicalJson(content);
};

interface PieceChange {
  readonly ops: LibraryOp[];
  readonly dropped: string[];
  readonly highlights: readonly ReadHighlight[];
  readonly refused: readonly RefusedBlock[];
}

// a dirty piece's text as the blocks it reads as, in its section
const readPiece = (piece: Stretch, section: LibrarySection, ports: EditPorts) => {
  const read = readPortsFor(piece.blocks, ports);
  const converted = rootToSlate(headlessEditor(), parseMdast(piece.text).root);
  const value: TElement[] = converted.ok ? elementsOf(converted.nodes) : [];
  const drafts = readBlocks(
    settled(elementsOf(embedFiles(value, read))),
    read,
    section === "note" ? ports : null,
  );
  return { highlights: drafts.highlights, named: nameDrafts(drafts.blocks, ports.newBlockId) };
};

interface Lined {
  readonly ops: LibraryOp[];
  // each new block's order key where it keeps an old one's, null where an insert needs one
  readonly keys: (string | null)[];
}

// the new blocks lined up with the old: an unchanged one is left be, a changed one put under the
// old one's id, and what is left over dropped or inserted
const lineUp = (old: readonly ViewBlock[], fresh: readonly LibraryBlock[]): Lined => {
  const diff = diffLines(
    old.map((one) => contentKey(one.block)),
    fresh.map(contentKey),
  );
  const ops: LibraryOp[] = [];
  const keys: (string | null)[] = fresh.map(() => null);
  let oldAt = 0;
  let freshAt = 0;
  const keep = (to: number): void => {
    for (; oldAt < to; oldAt += 1, freshAt += 1) {
      keys[freshAt] = old[oldAt]?.ord ?? null;
    }
  };
  for (const hunk of diff.hunks) {
    keep(hunk.baseStart);
    const paired = Math.min(hunk.baseEnd - hunk.baseStart, hunk.sideEnd - hunk.sideStart);
    for (let index = 0; index < paired; index += 1) {
      const was = old[hunk.baseStart + index];
      const now = fresh[hunk.sideStart + index];
      if (was !== undefined && now !== undefined) {
        ops.push({ baseHash: was.hash, block: { ...now, id: was.block.id }, op: "put" });
        keys[hunk.sideStart + index] = was.ord;
      }
    }
    for (const was of old.slice(hunk.baseStart + paired, hunk.baseEnd)) {
      ops.push({ baseHash: was.hash, blockId: was.block.id, op: "drop" });
    }
    oldAt = hunk.baseEnd;
    freshAt = hunk.sideEnd;
  }
  keep(old.length);
  return { keys, ops };
};

// an insert for every new block with no key, each run minted between the keys around it
const insertsOf = (
  fresh: readonly LibraryBlock[],
  keys: readonly (string | null)[],
  bounds: { lower: string | null; upper: string | null },
  section: LibrarySection,
): LibraryOp[] => {
  const ops: LibraryOp[] = [];
  for (let index = 0; index < fresh.length; index += 1) {
    if (keys[index] !== null) {
      continue;
    }
    let end = index;
    while (end < fresh.length && keys[end] === null) {
      end += 1;
    }
    const before = index === 0 ? bounds.lower : (keys[index - 1] ?? null);
    const after = end < fresh.length ? (keys[end] ?? null) : bounds.upper;
    for (const [offset, ord] of ordsBetween(before, after, end - index).entries()) {
      const block = fresh[index + offset];
      if (block !== undefined) {
        ops.push({ block, op: "insert", ord, section });
      }
    }
    index = end;
  }
  return ops;
};

// the blocks a dirty piece's text reads as, landed over the ones it replaced (a section that held
// none gets them all, between no keys)
const changeOf = (piece: Stretch, view: ItemView, ports: EditPorts): PieceChange => {
  const { section } = piece;
  const { highlights, named } = readPiece(piece, section, ports);
  const lined = lineUp(piece.blocks, named.blocks);
  const ordered = view.blocks.filter((one) => one.section === section);
  const [first] = piece.blocks;
  const last = piece.blocks.at(-1);
  const bounds =
    first === undefined || last === undefined
      ? { lower: null, upper: null }
      : {
          lower: ordered[ordered.indexOf(first) - 1]?.ord ?? null,
          upper: ordered[ordered.indexOf(last) + 1]?.ord ?? null,
        };
  const kept = markerIds(named.blocks);
  const dropped = [...markerIds(piece.blocks.map((one) => one.block))].filter(
    (id) => !kept.has(id),
  );
  return {
    dropped,
    highlights,
    ops: [...lined.ops, ...insertsOf(named.blocks, lined.keys, bounds, section)],
    refused: named.refused,
  };
};

const changesOf = (pieces: readonly Piece[], view: ItemView, ports: EditPorts): ViewChange => {
  const changes = pieces
    .filter(isStretch)
    .filter((piece) => piece.dirty)
    .map((piece) => changeOf(piece, view, ports));
  return {
    dropped: [...new Set(changes.flatMap((change) => change.dropped))].toSorted(),
    highlights: changes.flatMap((change) => change.highlights),
    kind: "changed",
    ops: changes.flatMap((change) => change.ops),
    refused: changes.flatMap((change) => change.refused),
  };
};

// the agent's edits, in order, each against the text the ones before it left
export const editItemView = (
  blocks: ReadonlyMap<string, StoredBlock>,
  edits: readonly ViewEdit[],
  ports: EditPorts,
): EditOutcome => {
  const view = itemView(blocks, ports);
  let pieces = piecesOf(view);
  for (const [index, edit] of edits.entries()) {
    if (edit.oldText === "") {
      return { kind: "refused", refusal: { edit: index, kind: "empty" } };
    }
    const text = pieces.map((piece) => piece.text).join("");
    const found = occurrences(text, edit.oldText);
    const [start] = found;
    if (start === undefined) {
      return { kind: "refused", refusal: { edit: index, kind: "missing" } };
    }
    if (found.length > 1) {
      return { kind: "refused", refusal: { count: found.length, edit: index, kind: "ambiguous" } };
    }
    const next = replaceRange(pieces, {
      end: start + edit.oldText.length,
      start,
      text: edit.newText,
    });
    if (next === null) {
      return { kind: "refused", refusal: { edit: index, kind: "section" } };
    }
    pieces = next;
  }
  return changesOf(pieces, view, ports);
};

export interface PlacedQuotes extends ViewChange {
  // the quotes whose markers now wrap their passage, those already wrapped included
  readonly placed: readonly string[];
  // the quotes no passage of the item matched
  readonly missing: readonly string[];
}

// highlights made away from the editor placed in the item's text by their quotes (the page first,
// then the person's note), their markers spliced in as `placeQuotes` splices them in a file
export const placeItemQuotes = (
  blocks: ReadonlyMap<string, StoredBlock>,
  quotes: readonly PendingQuote[],
  ports: EditPorts,
): PlacedQuotes => {
  const view = itemView(blocks, ports);
  let pieces = piecesOf(view);
  const placed: string[] = [];
  let waiting = quotes;
  for (const section of ["article", "note"] as const) {
    const inSection = view.blocks.filter((one) => one.section === section);
    const [head] = inSection;
    const tail = inSection.at(-1);
    if (head === undefined || tail === undefined || waiting.length === 0) {
      continue;
    }
    // the article is placed first and stands after the note, so a section's text still starts
    // where the view put it
    const offset = head.start;
    const before = view.markdown.slice(head.start, tail.end);
    const placing = placeQuotes(before, waiting, { final: false });
    placed.push(...placing.placed);
    waiting = waiting.filter((quote) => placing.missing.includes(quote.id));
    // the one stretch the markers changed, between the text's shared head and tail
    let prefix = 0;
    while (prefix < before.length && before[prefix] === placing.content[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      before[before.length - 1 - suffix] === placing.content[placing.content.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    if (placing.content !== before) {
      const next = replaceRange(pieces, {
        end: offset + before.length - suffix,
        start: offset + prefix,
        text: placing.content.slice(prefix, placing.content.length - suffix),
      });
      pieces = next ?? pieces;
    }
  }
  return { ...changesOf(pieces, view, ports), missing: waiting.map((quote) => quote.id), placed };
};
