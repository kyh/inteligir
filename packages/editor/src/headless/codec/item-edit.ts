import { canonicalJson } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock, LibraryNode } from "@repo/contract/library/library-nodes";
import { diffLines } from "@repo/editor/headless/text/line-diff";

import { articleView, noteView } from "./item-view";
import type { NoteView } from "./item-view";
import { libraryLinks } from "./library-links";
import type { LibraryLinks, LibraryLookup } from "./library-links";
import { readBodyPart } from "./read-body";
import type { ReadPorts } from "./read-blocks";
import type { BodyChange } from "@repo/editor/headless/body/body-change";

export interface ViewEdit {
  readonly oldText: string;
  readonly newText: string;
}

export interface EditPorts extends LibraryLookup {
  readonly newBlockId: () => string;
}

type EditRefusal =
  | { readonly kind: "missing"; readonly edit: number }
  | { readonly kind: "ambiguous"; readonly edit: number; readonly count: number }
  | { readonly kind: "section"; readonly edit: number }
  | { readonly kind: "too-deep" | "unstorable"; readonly edit: number };

export type EditOutcome =
  | { readonly kind: "changed"; readonly changes: readonly BodyChange[] }
  | { readonly kind: "refused"; readonly refusal: EditRefusal }
  | { readonly kind: "failed"; readonly edit: number; readonly error: Error };

type Piece =
  | { readonly kind: "gap"; readonly text: string }
  | { readonly kind: "group"; readonly text: string; readonly blocks: readonly LibraryBlock[] }
  | {
      readonly kind: "edited";
      readonly text: string;
      readonly blocks: readonly LibraryBlock[];
      readonly edit: number;
    };

const gap = (text: string) => (text === "" ? [] : [{ kind: "gap", text }]) satisfies Piece[];

const piecesOf = (note: NoteView) => {
  const pieces: Piece[] = [];
  let cursor = 0;

  for (const group of note.groups) {
    pieces.push(...gap(note.text.slice(cursor, group.start)), {
      blocks: group.blocks,
      kind: "group",
      text: group.text,
    });
    cursor = group.start + group.text.length;
  }

  return [...pieces, ...gap(note.text.slice(cursor))] satisfies Piece[];
};

const textOf = (pieces: readonly Piece[]) => pieces.map((piece) => piece.text).join("");

const occurrences = (text: string, needle: string) => {
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

const replaceRange = (pieces: readonly Piece[], range: Range) => {
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
  ] satisfies Piece[];
};

const appended = (pieces: readonly Piece[], text: string, edit: number) =>
  [
    ...pieces,
    ...gap(pieces.length === 0 ? "" : "\n\n"),
    { blocks: [], edit, kind: "edited", text },
  ] satisfies Piece[];

const readPortsFor = (replaced: readonly LibraryBlock[], ports: EditPorts, links: LibraryLinks) => {
  const before = new Map<string, string>();

  const visit = (node: LibraryNode) => {
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
  } satisfies ReadPorts;
};

const contentKey = (block: LibraryBlock) => {
  const { id: _id, ...content } = block;

  return canonicalJson(content);
};

interface Lined {
  readonly changes: BodyChange[];
  readonly ids: readonly string[];
  readonly inserts: readonly LibraryBlock[];
}

const lineUp = (old: readonly LibraryBlock[], fresh: readonly LibraryBlock[]) => {
  const diff = diffLines(old.map(contentKey), fresh.map(contentKey));
  const changes: BodyChange[] = [];
  const ids = fresh.map((block) => block.id);

  const standsAs = (at: number, was: LibraryBlock | undefined) => {
    if (was !== undefined) {
      ids[at] = was.id;
    }
  };

  let oldAt = 0;
  let freshAt = 0;

  const keep = (to: number) => {
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

  return {
    changes,
    ids,
    inserts: fresh.filter((block, index) => ids[index] === block.id),
  } satisfies Lined;
};

const insertsOf = (pieces: readonly Piece[], lined: ReadonlyMap<Piece, Lined>) => {
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

const changesOf = (pieces: readonly Piece[], ports: EditPorts) => {
  const links = libraryLinks(ports);
  const lined = new Map<Piece, Lined>();

  for (const piece of pieces) {
    if (piece.kind !== "edited") {
      continue;
    }

    const read = readBodyPart(piece.text, {
      links: readPortsFor(piece.blocks, ports, links),
      newBlockId: ports.newBlockId,
      wiki: links.wiki,
    });

    if (!read.ok && read.reason.kind === "failed") {
      return { edit: piece.edit, error: read.reason.error, kind: "failed" } satisfies EditOutcome;
    }

    if (!read.ok || read.refused > 0) {
      const kind = read.ok ? "unstorable" : "too-deep";

      return { kind: "refused", refusal: { edit: piece.edit, kind } } satisfies EditOutcome;
    }

    lined.set(piece, lineUp(piece.blocks, read.blocks));
  }

  return {
    changes: [...[...lined.values()].flatMap((one) => one.changes), ...insertsOf(pieces, lined)],
    kind: "changed",
  } satisfies EditOutcome;
};

export const editItemView = (
  blocks: readonly BodyBlock[],
  edits: readonly ViewEdit[],
  ports: EditPorts,
) => {
  let pieces = piecesOf(noteView(blocks, ports));

  for (const [index, edit] of edits.entries()) {
    if (edit.oldText === "") {
      pieces = appended(pieces, edit.newText, index);
      continue;
    }

    const text = textOf(pieces);
    const found = occurrences(text, edit.oldText);
    const [start] = found;

    if (start === undefined) {
      const kind = `${text}${articleView(blocks, ports)}`.includes(edit.oldText)
        ? "section"
        : "missing";

      return { kind: "refused", refusal: { edit: index, kind } } satisfies EditOutcome;
    }

    if (found.length > 1) {
      return {
        kind: "refused",
        refusal: { count: found.length, edit: index, kind: "ambiguous" },
      } satisfies EditOutcome;
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
