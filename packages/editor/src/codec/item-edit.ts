// An agent's edit to an item, made on its view (`item-view.ts`) and landed as block ops. Each
// `old_text` must stand exactly once in the view as the edits before it left it; the blocks the
// edited text touches (a list whole) are read again from the new text and no others, so every
// other block keeps its id, its place and its highlights' markers. The blocks read again keep the
// ids of the old ones they line up with (unchanged ones change nothing), a highlight one of whose
// marker edges the new text no longer holds is named in the answer, and a link the agent kept or
// wrote by title still names its item. Text that nests deeper than the editor reads, or that no
// block can store, refuses the edit, so no block it spans is lost. A highlight placed away from the
// editor (`placeQuotes`) lands the same way.

import type { TElement } from "platejs";

import { placeQuotes } from "@repo/notes/annotations/place-quotes";
import type { PendingQuote } from "@repo/notes/annotations/place-quotes";
import type { FileKind } from "@repo/notes/items/item-kind";
import type { LibraryOp, StoredBlock } from "@repo/notes/library/block-ops";
import { placeInOrder } from "@repo/notes/library/block-order";
import { canonicalJson } from "@repo/notes/library/canonical-json";
import type { LibraryBlock, LibraryNode, LibrarySection } from "@repo/notes/library/library-nodes";
import type { FlowSpan } from "@repo/notes/markdown/flow-spans";
import { splitMarkerIds } from "@repo/notes/markdown/remark-inline-constructs";
import { obsidianReader } from "@repo/notes/markdown/remark-obsidian";
import type { ObsidianHighlight, ObsidianReader } from "@repo/notes/markdown/remark-obsidian";
import { isUuidWikiAlias } from "@repo/notes/markdown/remark-wiki-link";
import type { WikiBody } from "@repo/notes/markdown/remark-wiki-link";
import { diffLines } from "@repo/notes/text/line-diff";

import { headlessEditor } from "@repo/editor/markdown/markdown-doc";
import { mdToSlate } from "@repo/editor/markdown/md-to-slate";

import { itemView, viewFileAt } from "./item-view";
import type { ItemView, ViewBlock, ViewPorts } from "./item-view";
import { nameDrafts } from "./name-blocks";
import { readBlocks } from "./read-blocks";
import type { LibraryFile, ReadPorts, Reached } from "./read-blocks";
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

// why an edit's text cannot be read again as blocks: it changed a line the article section opens
// or closes on, or wrote after its close, or it nests deeper than the editor reads
type CutFailure = "section" | "too-deep";

type EditRefusal =
  // an `old_text` that is empty, stands nowhere, or stands more than once
  | { readonly kind: "empty"; readonly edit: number }
  | { readonly kind: "missing"; readonly edit: number }
  | { readonly kind: "ambiguous"; readonly edit: number; readonly count: number }
  | { readonly kind: CutFailure; readonly edit: number }
  | Unstorable;

// new text that reads as a block no store takes: `edit` is the last one to touch it
interface Unstorable {
  readonly kind: "unstorable";
  readonly edit: number;
}

interface ViewChange {
  readonly kind: "changed";
  readonly ops: readonly LibraryOp[];
  // highlights the edit took a marker edge of out of the text, by id
  readonly dropped: readonly string[];
  // bare highlights an `==x==` in the new text made, for the caller to store
  readonly highlights: readonly ObsidianHighlight[];
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
  // the editor's value an edited stretch's text reads as, read when the edit cut it; null for a
  // stretch no edit changed
  readonly edited: Edited | null;
}

interface Edited {
  readonly edit: number;
  readonly value: TElement[];
  // what read the value's Obsidian spellings: a note's, and none for a page's
  readonly reader: ObsidianReader | null;
}

interface EditedStretch extends Stretch {
  readonly edited: Edited;
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

const isEdited = (piece: Piece): piece is EditedStretch =>
  isStretch(piece) && piece.edited !== null;

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
      pieces.push({ blocks: [], edited: null, kind: "gap", section, text });
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
      edited: null,
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
  readonly edit: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

// the pieces an edit cut, or why it could not cut them
type Cut =
  | { readonly ok: true; readonly pieces: Piece[] }
  | { readonly ok: false; readonly reason: CutFailure };

const failed = (reason: CutFailure): Cut => ({ ok: false, reason });

// the value a stretch's edited text reads as in its section; null when it nests deeper than the
// conversion reaches
const editedAs = (
  text: string,
  section: LibrarySection,
  edit: number,
  ports: EditPorts,
): Edited | null => {
  const reader = section === "note" ? obsidianReader(ports.newAnnotationId) : null;
  const converted = mdToSlate(headlessEditor(), text, reader?.read);
  return converted.ok ? { edit, reader, value: elementsOf(converted.nodes) } : null;
};

// the edited text of a run of pieces cut at each section line it still holds once, each stretch
// between two lines one edited piece in its own section, read as it is cut
const cutAtLines = (run: readonly Piece[], text: string, edit: number, ports: EditPorts): Cut => {
  const out: Piece[] = [];
  let cursor = 0;
  let blocks: ViewBlock[] = [];
  let section = run.find(isStretch)?.section ?? "note";
  const stretch = (to: number, at: LibrarySection | null): CutFailure | "cut" => {
    const part = text.slice(cursor, to);
    if (part === "" && blocks.length === 0) {
      return "cut";
    }
    if (at === null) {
      return "section";
    }
    const edited = editedAs(part, at, edit, ports);
    if (edited === null) {
      return "too-deep";
    }
    out.push({ blocks, edited, kind: "blocks", section: at, text: part });
    blocks = [];
    return "cut";
  };
  // the text after the last line, in the section that line opened (none after the close)
  const finish = (at: LibrarySection | null): Cut => {
    const step = stretch(text.length, at);
    return step === "cut" ? { ok: true, pieces: out } : failed(step);
  };
  for (const piece of run) {
    if (isStretch(piece)) {
      blocks.push(...piece.blocks);
      continue;
    }
    const at = text.indexOf(piece.text, cursor);
    if (at === -1 || occurrences(text, piece.text).length !== 1) {
      return failed("section");
    }
    const step = stretch(at, piece.before);
    if (step !== "cut") {
      return failed(step);
    }
    out.push(piece);
    cursor = at + piece.text.length;
    if (piece.after === null) {
      return finish(null);
    }
    section = piece.after;
  }
  return finish(section);
};

// one range of the current text replaced: the pieces it touches, and a block on either side of
// the lines it starts or ends in, read again as one
const replaceRange = (pieces: readonly Piece[], range: Range, ports: EditPorts): Cut => {
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
  const cut = cutAtLines(run, text, range.edit, ports);
  return cut.ok
    ? { ok: true, pieces: [...pieces.slice(0, first), ...cut.pieces, ...pieces.slice(last + 1)] }
    : cut;
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

interface MarkerEdge {
  readonly id: string;
  readonly edge: "start" | "end";
}

// every highlight edge the blocks hold, one per id a marker opens or closes
const markerEdges = (blocks: readonly LibraryBlock[]): MarkerEdge[] => {
  const edges: MarkerEdge[] = [];
  const visit = (node: LibraryNode): void => {
    if ("text" in node) {
      return;
    }
    if (node.type === "annotationMarker") {
      edges.push(...splitMarkerIds(node.ids).map((id) => ({ edge: node.edge, id })));
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const block of blocks) {
    visit(block);
  }
  return edges;
};

const edgeKey = ({ edge, id }: MarkerEdge): string => `${edge}:${id}`;

const contentKey = (block: LibraryBlock): string => {
  const { id: _id, ...content } = block;
  return canonicalJson(content);
};

interface PieceChange extends Lined {
  // the blocks the piece's text now reads as
  readonly blocks: readonly LibraryBlock[];
  readonly highlights: readonly ObsidianHighlight[];
  readonly edit: number;
  // the blocks the text held that no store takes
  readonly refused: number;
}

// an edited piece's value as the blocks it reads as, in its section
const readPiece = (piece: EditedStretch, ports: EditPorts) => {
  const read = readPortsFor(piece.blocks, ports);
  const { reader, value } = piece.edited;
  const drafts = readBlocks(settled(elementsOf(embedFiles(value, read)), reader?.read), read);
  return {
    highlights: reader?.highlights ?? [],
    named: nameDrafts(drafts, ports.newBlockId),
  };
};

interface Lined {
  readonly ops: LibraryOp[];
  // the id each new block stands under, in order: the old one's it lines up with, else its own
  readonly ids: readonly string[];
  // the new blocks that line up with no old one
  readonly inserts: readonly LibraryBlock[];
}

// the new blocks lined up with the old: an unchanged one is left be, a changed one put under the
// old one's id, a block left over dropped, and one with no old one to line up with an insert
const lineUp = (old: readonly ViewBlock[], fresh: readonly LibraryBlock[]): Lined => {
  const diff = diffLines(
    old.map((one) => contentKey(one.block)),
    fresh.map(contentKey),
  );
  const ops: LibraryOp[] = [];
  const ids = fresh.map((block) => block.id);
  const standsAs = (at: number, was: ViewBlock | undefined): void => {
    if (was !== undefined) {
      ids[at] = was.block.id;
    }
  };
  let oldAt = 0;
  let freshAt = 0;
  const keep = (to: number): void => {
    for (; oldAt < to; oldAt += 1, freshAt += 1) {
      standsAs(freshAt, old[oldAt]);
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
        standsAs(hunk.sideStart + index, was);
      }
    }
    for (const was of old.slice(hunk.baseStart + paired, hunk.baseEnd)) {
      ops.push({ baseHash: was.hash, blockId: was.block.id, op: "drop" });
    }
    oldAt = hunk.baseEnd;
    freshAt = hunk.sideEnd;
  }
  keep(old.length);
  return { ids, inserts: fresh.filter((block, index) => ids[index] === block.id), ops };
};

// the blocks an edited piece's text reads as, lined up with the ones it replaced
const changeOf = (piece: EditedStretch, ports: EditPorts): PieceChange => {
  const { highlights, named } = readPiece(piece, ports);
  return {
    ...lineUp(piece.blocks, named.blocks),
    blocks: named.blocks,
    edit: piece.edited.edit,
    highlights,
    refused: named.refused,
  };
};

// a section's new blocks in their places. Two devices can mint one key, so what stands either side
// of a new block may hold one key and leave no room: `placeInOrder` moves one of them, as a save
// from the editor does
const placementOf = (
  section: LibrarySection,
  pieces: readonly Piece[],
  changes: ReadonlyMap<Piece, PieceChange>,
  view: ItemView,
): LibraryOp[] => {
  const order = pieces
    .filter(isStretch)
    .filter((piece) => piece.section === section)
    .flatMap((piece) => changes.get(piece)?.ids ?? piece.blocks.map((one) => one.block.id));
  const stands = new Set(order);
  const current = new Map(
    view.blocks
      .filter((one) => one.section === section && stands.has(one.block.id))
      .map((one) => [one.block.id, one.ord]),
  );
  const inserts = new Map(
    [...changes.values()].flatMap((change) => change.inserts).map((block) => [block.id, block]),
  );
  return [...placeInOrder(order, current, new Map())].flatMap(([id, ord]): LibraryOp[] => {
    const block = inserts.get(id);
    if (block !== undefined) {
      return [{ block, op: "insert", ord, section }];
    }
    const baseOrd = current.get(id);
    return baseOrd === undefined || baseOrd === ord
      ? []
      : [{ baseOrd, blockId: id, op: "move", ord }];
  });
};

// every edited piece landed; a highlight is dropped when the edited text lost either edge of it,
// wherever in the edited text the edge went, so a highlight left unpaired is named too. Text no
// block can store lands nothing, since the old block would go with no new one in its place
const changesOf = (
  pieces: readonly Piece[],
  view: ItemView,
  ports: EditPorts,
): ViewChange | Unstorable => {
  const edited = pieces.filter(isEdited);
  const byPiece = new Map(edited.map((piece) => [piece, changeOf(piece, ports)] as const));
  const changes = [...byPiece.values()];
  const refused = changes.find((change) => change.refused > 0);
  if (refused !== undefined) {
    return { edit: refused.edit, kind: "unstorable" };
  }
  const kept = new Set(changes.flatMap((change) => markerEdges(change.blocks)).map(edgeKey));
  const lost = edited
    .flatMap((piece) => markerEdges(piece.blocks.map((one) => one.block)))
    .filter((edge) => !kept.has(edgeKey(edge)));
  const adding = new Set(
    edited
      .filter((piece) => (byPiece.get(piece)?.inserts.length ?? 0) > 0)
      .map((piece) => piece.section),
  );
  return {
    dropped: [...new Set(lost.map((edge) => edge.id))].toSorted(),
    highlights: changes.flatMap((change) => change.highlights),
    kind: "changed",
    ops: [
      ...changes.flatMap((change) => change.ops),
      ...[...adding].flatMap((section) => placementOf(section, pieces, byPiece, view)),
    ],
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
    const next = replaceRange(
      pieces,
      { edit: index, end: start + edit.oldText.length, start, text: edit.newText },
      ports,
    );
    if (!next.ok) {
      return { kind: "refused", refusal: { edit: index, kind: next.reason } };
    }
    ({ pieces } = next);
  }
  const change = changesOf(pieces, view, ports);
  return change.kind === "changed" ? change : { kind: "refused", refusal: change };
};

export interface PlacedQuotes extends ViewChange {
  // the quotes whose markers now wrap their passage, those already wrapped included
  readonly placed: readonly string[];
  // the quotes no passage of the item matched
  readonly missing: readonly string[];
}

// highlights made away from the editor placed in the item's text by their quotes (the page first,
// then the person's note), their markers spliced in as `placeQuotes` splices them in a file; one
// whose markers any block holds already is placed where it stands, never a second time in the
// other section
export const placeItemQuotes = (
  blocks: ReadonlyMap<string, StoredBlock>,
  quotes: readonly PendingQuote[],
  ports: EditPorts,
): PlacedQuotes => {
  const view = itemView(blocks, ports);
  let pieces = piecesOf(view);
  const marked = new Set(
    markerEdges([...blocks.values()].map((stored) => stored.block)).map(({ id }) => id),
  );
  const placed = quotes.filter((quote) => marked.has(quote.id)).map((quote) => quote.id);
  let waiting = quotes.filter((quote) => !marked.has(quote.id));
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
      const next = replaceRange(
        pieces,
        {
          edit: 0,
          end: offset + before.length - suffix,
          start: offset + prefix,
          text: placing.content.slice(prefix, placing.content.length - suffix),
        },
        ports,
      );
      if (!next.ok) {
        // the markers go only in reading text, so they change no nesting and touch no line a
        // section or a container stands on, and the text around them is the view of stored
        // blocks, which nest no deeper than the vocabulary allows
        throw new Error(`a section's own text did not read back once highlighted (${next.reason})`);
      }
      ({ pieces } = next);
    }
  }
  const change = changesOf(pieces, view, ports);
  if (change.kind !== "changed") {
    // markers go only in reading text, which a block past its cap is cut along
    throw new Error("a section's own text did not store once highlighted");
  }
  return { ...change, missing: waiting.map((quote) => quote.id), placed };
};
