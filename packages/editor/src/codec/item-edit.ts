// An agent's edit to an item, made on its view (`item-view.ts`) and landed as changes to its live
// body by block id (`../live/body-change`), each naming the block as the view read it. An edit
// writes in the note alone: the article is the page as it was read, which no edit changes. Each
// `old_text` must stand exactly once in the note as the edits before it left it, and an empty one
// adds its new text after the note; the groups the edited text touches are read again from the new
// text and no others, so every other block keeps its id and its place. The blocks read again keep
// the ids of the old ones they line up with (unchanged ones change nothing), and a link the agent
// kept or wrote by title still names its item. Text that nests deeper than the editor reads, or
// that no block can store, refuses the edit, so no block it spans is lost.

import { canonicalJson } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock, LibraryNode } from "@repo/contract/library/library-nodes";
import { diffLines } from "@repo/editor/text/line-diff";

import { itemView } from "./item-view";
import type { ItemView } from "./item-view";
import { libraryLinks } from "./library-links";
import type { LibraryLinks, LibraryLookup } from "./library-links";
import { readBody } from "./read-body";
import type { ReadPorts } from "./read-blocks";
import type { BodyChange } from "../live/body-change";

export interface ViewEdit {
  // empty to add `newText` after the note
  readonly oldText: string;
  readonly newText: string;
}

export interface EditPorts extends LibraryLookup {
  readonly newBlockId: () => string;
}

type EditRefusal =
  // an `old_text` that stands nowhere in the note, or more than once
  | { readonly kind: "missing"; readonly edit: number }
  | { readonly kind: "ambiguous"; readonly edit: number; readonly count: number }
  // an `old_text` that reaches the article
  | { readonly kind: "section"; readonly edit: number }
  // new text that nests deeper than the editor reads, or reads as a block no store takes: `edit`
  // is the last one to touch it
  | { readonly kind: "too-deep" | "unstorable"; readonly edit: number };

export type EditOutcome =
  | { readonly kind: "changed"; readonly changes: readonly BodyChange[] }
  | { readonly kind: "refused"; readonly refusal: EditRefusal }
  // a rule failed reading an edit's new text, which is the codec's fault and not the text's
  | { readonly kind: "failed"; readonly edit: number; readonly error: Error };

// a stretch of the note's text: the lines between two groups, a group as the view wrote it, or
// text an edit left in place of the blocks it touched (none, for text it added)
type Piece =
  | { readonly kind: "gap"; readonly text: string }
  | { readonly kind: "group"; readonly text: string; readonly blocks: readonly LibraryBlock[] }
  | {
      readonly kind: "edited";
      readonly text: string;
      readonly blocks: readonly LibraryBlock[];
      // the last edit to change it
      readonly edit: number;
    };

const gap = (text: string): Piece[] => (text === "" ? [] : [{ kind: "gap", text }]);

const piecesOf = (view: ItemView): Piece[] => {
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const group of view.groups.filter((one) => one.section === "note")) {
    pieces.push(...gap(view.markdown.slice(cursor, group.start)), {
      blocks: group.blocks,
      kind: "group",
      text: group.text,
    });
    cursor = group.start + group.text.length;
  }
  return [...pieces, ...gap(view.markdown.slice(cursor, view.noteEnd))];
};

const textOf = (pieces: readonly Piece[]): string => pieces.map((piece) => piece.text).join("");

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

// one range of the current text replaced: the pieces it touches, and a group on either side of
// the lines it starts or ends in, become one edited piece
const replaceRange = (pieces: readonly Piece[], range: Range): Piece[] => {
  let at = 0;
  const spans = pieces.map((piece) => {
    const span = { end: at + piece.text.length, start: at };
    at = span.end;
    return span;
  });
  const touched = pieces.flatMap((piece, index) => {
    const span = spans[index] ?? { end: 0, start: 0 };
    const touches =
      piece.kind === "gap"
        ? span.start < range.end && span.end > range.start
        : span.start <= range.end && span.end >= range.start;
    return touches ? [index] : [];
  });
  let first = touched[0] ?? 0;
  let last = touched.at(-1) ?? first;
  while (first > 0 && pieces[first]?.kind === "gap") {
    first -= 1;
  }
  while (last < pieces.length - 1 && pieces[last]?.kind === "gap") {
    last += 1;
  }
  const from = spans[first]?.start ?? 0;
  const run = pieces.slice(first, last + 1);
  const whole = textOf(run);
  return [
    ...pieces.slice(0, first),
    {
      blocks: run.flatMap((piece) => (piece.kind === "gap" ? [] : piece.blocks)),
      edit: range.edit,
      kind: "edited",
      text: whole.slice(0, range.start - from) + range.text + whole.slice(range.end - from),
    },
    ...pieces.slice(last + 1),
  ];
};

// new text after the note, a blank line below what stands there, replacing no block
const appended = (pieces: readonly Piece[], text: string, edit: number): Piece[] => [
  ...pieces,
  ...gap(pieces.length === 0 ? "" : "\n\n"),
  { blocks: [], edit, kind: "edited", text },
];

// what a page link the agent kept or wrote names: an item a replaced block linked (its title
// live, or the one it showed when the item is gone), or one the library holds
const readPortsFor = (
  replaced: readonly LibraryBlock[],
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
  for (const block of replaced) {
    visit(block);
  }
  return {
    image: links.image,
    item: (key) => {
      const shown = before.get(key);
      return shown === undefined
        ? links.item(key)
        : { itemId: key, title: ports.title(key) ?? shown };
    },
  };
};

const contentKey = (block: LibraryBlock): string => {
  const { id: _id, ...content } = block;
  return canonicalJson(content);
};

interface Lined {
  readonly changes: BodyChange[];
  // the id each new block stands under, in order: the old one's it lines up with, else its own
  readonly ids: readonly string[];
  // the new blocks that line up with no old one
  readonly inserts: readonly LibraryBlock[];
}

// the new blocks lined up with the old: an unchanged one is left be, a changed one put under the
// old one's id, a block left over dropped, and one with no old one to line up with an insert
const lineUp = (old: readonly LibraryBlock[], fresh: readonly LibraryBlock[]): Lined => {
  const diff = diffLines(old.map(contentKey), fresh.map(contentKey));
  const changes: BodyChange[] = [];
  const ids = fresh.map((block) => block.id);
  const standsAs = (at: number, was: LibraryBlock | undefined): void => {
    if (was !== undefined) {
      ids[at] = was.id;
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
        changes.push({ base: was, block: { ...now, id: was.id }, blockId: was.id, kind: "put" });
        standsAs(hunk.sideStart + index, was);
      }
    }
    for (const was of old.slice(hunk.baseStart + paired, hunk.baseEnd)) {
      changes.push({ base: was, blockId: was.id, kind: "drop" });
    }
    oldAt = hunk.baseEnd;
    freshAt = hunk.sideEnd;
  }
  keep(old.length);
  return { changes, ids, inserts: fresh.filter((block, index) => ids[index] === block.id) };
};

// each new block after the one it follows once every edit landed, in reading order, so the block
// it names is in the body by then: one standing there already, or one inserted before it
const insertsOf = (pieces: readonly Piece[], lined: ReadonlyMap<Piece, Lined>): BodyChange[] => {
  const inserts = new Map(
    [...lined.values()].flatMap((change) => change.inserts).map((block) => [block.id, block]),
  );
  const out: BodyChange[] = [];
  let afterId: string | null = null;
  for (const piece of pieces) {
    const ids =
      piece.kind === "gap" ? [] : (lined.get(piece)?.ids ?? piece.blocks.map(({ id }) => id));
    for (const id of ids) {
      const block = inserts.get(id);
      if (block !== undefined) {
        out.push({ afterId, block, kind: "insertAfter", section: "note" });
      }
      afterId = id;
    }
  }
  return out;
};

// every edited piece read again and landed. Text the read refuses or no block can store lands
// nothing, since the old block would go with no new one in its place
const changesOf = (pieces: readonly Piece[], ports: EditPorts): EditOutcome => {
  const links = libraryLinks(ports);
  const lined = new Map<Piece, Lined>();
  for (const piece of pieces) {
    if (piece.kind !== "edited") {
      continue;
    }
    const read = readBody(piece.text, {
      links: readPortsFor(piece.blocks, ports, links),
      newBlockId: ports.newBlockId,
      wiki: links.wiki,
    });
    if (!read.ok && read.reason.kind === "failed") {
      return { edit: piece.edit, error: read.reason.error, kind: "failed" };
    }
    if (!read.ok || read.refused > 0) {
      const kind = read.ok ? "unstorable" : "too-deep";
      return { kind: "refused", refusal: { edit: piece.edit, kind } };
    }
    lined.set(piece, lineUp(piece.blocks, read.blocks));
  }
  return {
    changes: [...[...lined.values()].flatMap((one) => one.changes), ...insertsOf(pieces, lined)],
    kind: "changed",
  };
};

// the agent's edits, in order, each against the note's text as the ones before it left it, over
// the body's blocks in reading order
export const editItemView = (
  blocks: readonly BodyBlock[],
  edits: readonly ViewEdit[],
  ports: EditPorts,
): EditOutcome => {
  const view = itemView(blocks, ports);
  const article = view.markdown.slice(view.noteEnd);
  let pieces = piecesOf(view);
  for (const [index, edit] of edits.entries()) {
    if (edit.oldText === "") {
      pieces = appended(pieces, edit.newText, index);
      continue;
    }
    const text = textOf(pieces);
    const found = occurrences(text, edit.oldText);
    const [start] = found;
    if (start === undefined) {
      const kind = `${text}${article}`.includes(edit.oldText) ? "section" : "missing";
      return { kind: "refused", refusal: { edit: index, kind } };
    }
    if (found.length > 1) {
      return { kind: "refused", refusal: { count: found.length, edit: index, kind: "ambiguous" } };
    }
    pieces = replaceRange(pieces, {
      edit: index,
      end: start + edit.oldText.length,
      start,
      text: edit.newText,
    });
  }
  return changesOf(pieces, ports);
};
