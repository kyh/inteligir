// An agent's edit to an item, made on its view (`item-view.ts`) and landed as changes to its live
// body by block id (`../live/body-change`), each naming the block as the view read it. Each
// `old_text` must stand exactly once in the view as the edits before it left it; the blocks the
// edited text touches (a list whole) are read again from the new text and no others, so every
// other block keeps its id and its place. The blocks read again keep the ids of the old ones they
// line up with (unchanged ones change nothing), and a link the agent kept or wrote by title still
// names its item. Text that nests deeper than the editor reads, or that no block can store, refuses
// the edit, so no block it spans is lost.

import type { TElement } from "platejs";

import type { FileKind } from "@repo/contract/items/item-kind";
import { canonicalJson } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type {
  LibraryBlock,
  LibraryNode,
  LibrarySection,
} from "@repo/contract/library/library-nodes";
import type { FlowSpan } from "@repo/editor/markdown/flow-spans";
import type { WikiResolve } from "@repo/editor/markdown/remark-wiki-import";
import { diffLines } from "@repo/editor/text/line-diff";

import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";

import { itemView, viewFileAt } from "./item-view";
import type { ItemView, ViewBlock, ViewPorts } from "./item-view";
import { libraryLinks } from "./library-links";
import type { LibraryLinks } from "./library-links";
import { nameDrafts } from "./name-blocks";
import { readBlocks } from "./read-blocks";
import type { LibraryFile, LinkedItem, ReadPorts } from "./read-blocks";
import type { BodyChange } from "../live/body-change";

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
  readonly changes: readonly BodyChange[];
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

// the value a stretch's edited text reads as, the agent's `[[Title]]` read by the library's
// titles; null when it nests deeper than the conversion reaches
const editedAs = (text: string, edit: number, wiki: WikiResolve): Edited | null => {
  const read = parseMarkdown(text, undefined, { wiki });
  return read.ok ? { edit, value: read.value } : null;
};

// the edited text of a run of pieces cut at each section line it still holds once, each stretch
// between two lines one edited piece in its own section, read as it is cut
const cutAtLines = (run: readonly Piece[], text: string, edit: number, wiki: WikiResolve): Cut => {
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
    const edited = editedAs(part, edit, wiki);
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
const replaceRange = (pieces: readonly Piece[], range: Range, wiki: WikiResolve): Cut => {
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
  const cut = cutAtLines(run, text, range.edit, wiki);
  return cut.ok
    ? { ok: true, pieces: [...pieces.slice(0, first), ...cut.pieces, ...pieces.slice(last + 1)] }
    : cut;
};

// what a page link the agent kept or wrote names: an item a replaced block linked (its title
// live, or the one it showed when the item is gone), or one the library holds
const readPortsFor = (
  replaced: readonly ViewBlock[],
  ports: EditPorts,
  links: LibraryLinks,
): ReadPorts => {
  const before = new Map<string, string>();
  const visit = (node: LibraryNode): void => {
    if ("text" in node) {
      return;
    }
    if (node.type === "mention") {
      before.set(node.key, node.value);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const { block } of replaced) {
    visit(block);
  }
  const item = (key: string): LinkedItem | null => {
    const shown = before.get(key);
    return shown === undefined
      ? links.item(key)
      : { itemId: key, title: ports.title(key) ?? shown };
  };
  const image = (url: string): LibraryFile | null => {
    const file = viewFileAt(url);
    const kind = file === null ? null : ports.fileKind(file.sha);
    return file === null || kind === null
      ? null
      : { kind, name: file.name ?? file.sha, path: url, sha: file.sha };
  };
  return { image, item };
};

const contentKey = (block: LibraryBlock): string => {
  const { id: _id, ...content } = block;
  return canonicalJson(content);
};

interface PieceChange extends Lined {
  // the blocks the piece's text now reads as
  readonly blocks: readonly LibraryBlock[];
  readonly edit: number;
  // the blocks the text held that no store takes
  readonly refused: number;
}

// an edited piece's value as the blocks it reads as, in its section
const readPiece = (piece: EditedStretch, ports: EditPorts, links: LibraryLinks) =>
  nameDrafts(
    readBlocks(piece.edited.value, readPortsFor(piece.blocks, ports, links)),
    ports.newBlockId,
  );

interface Lined {
  readonly changes: BodyChange[];
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
  const changes: BodyChange[] = [];
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
        changes.push({
          base: was.block,
          block: { ...now, id: was.block.id },
          blockId: was.block.id,
          kind: "put",
        });
        standsAs(hunk.sideStart + index, was);
      }
    }
    for (const was of old.slice(hunk.baseStart + paired, hunk.baseEnd)) {
      changes.push({ base: was.block, blockId: was.block.id, kind: "drop" });
    }
    oldAt = hunk.baseEnd;
    freshAt = hunk.sideEnd;
  }
  keep(old.length);
  return { changes, ids, inserts: fresh.filter((block, index) => ids[index] === block.id) };
};

// the blocks an edited piece's text reads as, lined up with the ones it replaced
const changeOf = (piece: EditedStretch, ports: EditPorts, links: LibraryLinks): PieceChange => {
  const named = readPiece(piece, ports, links);
  return {
    ...lineUp(piece.blocks, named.blocks),
    blocks: named.blocks,
    edit: piece.edited.edit,
    refused: named.refused,
  };
};

// each new block after the one it follows once every edit landed, in reading order, so the block
// it names is in the body by then: one standing there already, or one inserted before it
const insertsOf = (
  pieces: readonly Piece[],
  changes: ReadonlyMap<Piece, PieceChange>,
): BodyChange[] => {
  const inserts = new Map(
    [...changes.values()].flatMap((change) => change.inserts).map((block) => [block.id, block]),
  );
  const out: BodyChange[] = [];
  let afterId: string | null = null;
  for (const piece of pieces.filter(isStretch)) {
    for (const id of changes.get(piece)?.ids ?? piece.blocks.map((one) => one.block.id)) {
      const block = inserts.get(id);
      if (block !== undefined) {
        out.push({ afterId, block, kind: "insertAfter", section: piece.section });
      }
      afterId = id;
    }
  }
  return out;
};

// every edited piece landed. Text no block can store lands nothing, since the old block would go
// with no new one in its place
const changesOf = (
  pieces: readonly Piece[],
  ports: EditPorts,
  links: LibraryLinks,
): ViewChange | Unstorable => {
  const edited = pieces.filter(isEdited);
  const byPiece = new Map(edited.map((piece) => [piece, changeOf(piece, ports, links)] as const));
  const changes = [...byPiece.values()];
  const refused = changes.find((change) => change.refused > 0);
  if (refused !== undefined) {
    return { edit: refused.edit, kind: "unstorable" };
  }
  return {
    changes: [...changes.flatMap((change) => change.changes), ...insertsOf(pieces, byPiece)],
    kind: "changed",
  };
};

// the agent's edits, in order, each against the text the ones before it left, over the body's
// blocks in reading order
export const editItemView = (
  blocks: readonly BodyBlock[],
  edits: readonly ViewEdit[],
  ports: EditPorts,
): EditOutcome => {
  const view = itemView(blocks, ports);
  const links = libraryLinks(ports);
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
      links.wiki,
    );
    if (!next.ok) {
      return { kind: "refused", refusal: { edit: index, kind: next.reason } };
    }
    ({ pieces } = next);
  }
  const change = changesOf(pieces, ports, links);
  return change.kind === "changed" ? change : { kind: "refused", refusal: change };
};
