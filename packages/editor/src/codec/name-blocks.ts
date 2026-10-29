// Drafts named and held to the vocabulary: each top-level block takes a fresh id and the
// vocabulary's parse, and one past the block cap (a pasted log, a dump in one fence) is cut into
// blocks of its own type, between its children or, for one long run of text, between its lines.
// What still cannot be stored (a rich block's source past the cap) is refused by name, its text
// kept in the answer so an import can say what it left out.

import { NodeApi } from "platejs";
import type { Descendant, TElement } from "platejs";

import { canonicalJson, utf8ByteLength } from "@repo/notes/library/canonical-json";
import { BLOCK_MAX_BYTES, storableBlockSchema } from "@repo/notes/library/library-nodes";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";

import { libraryJsonOf, namedBlockJson } from "./read-blocks";
import type { DraftBlock } from "./read-blocks";
import { isText, leaf, marksOf } from "./slate-leaves";

export interface RefusedBlock {
  // what the block said, as text
  readonly text: string;
  readonly reason: string;
}

export interface NamedBlocks {
  readonly blocks: readonly LibraryBlock[];
  readonly refused: readonly RefusedBlock[];
}

// room a cut leaves for the block's own props and its id, under the cap
const CUT_BUDGET = BLOCK_MAX_BYTES - 4096;
// a UTF-16 unit is at most three bytes of UTF-8, and its JSON escape at most six
const UNITS_PER_PIECE = Math.floor(CUT_BUDGET / 6);

const bytesOf = (node: Descendant): number => utf8ByteLength(canonicalJson(libraryJsonOf(node)));

const LOW_SURROGATE_MIN = 0xdc_00;
const LOW_SURROGATE_MAX = 0xdf_ff;

// a text cut in pieces of at most UNITS_PER_PIECE units, at a line's end where one is near, never
// between a surrogate pair
const textPieces = (text: string): string[] => {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > UNITS_PER_PIECE) {
    const lineEnd = rest.lastIndexOf("\n", UNITS_PER_PIECE);
    let at = lineEnd > UNITS_PER_PIECE / 2 ? lineEnd + 1 : UNITS_PER_PIECE;
    // the first code unit the next piece would start on: a pair's low half takes its high half
    // with it (`codePointAt` answers a low half alone, never the pair before it)
    const after = rest.codePointAt(at) ?? 0;
    if (after >= LOW_SURROGATE_MIN && after <= LOW_SURROGATE_MAX) {
      at -= 1;
    }
    pieces.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  pieces.push(rest);
  return pieces;
};

// an element as several of its own type, its children shared out in order, each under the budget:
// a child too long alone is cut first, a text between its lines and an element as a block is
const cutElement = (element: TElement): TElement[] => {
  const children = element.children.flatMap((child): Descendant[] => {
    if (isText(child)) {
      const marks = marksOf(child);
      return textPieces(child.text).map((piece) => leaf(piece, marks));
    }
    return bytesOf(child) > CUT_BUDGET ? cutElement(child) : [child];
  });
  // an element's JSON is its own props and each child's, a comma apart
  const shell = bytesOf({ ...element, children: [] });
  const parts: TElement[] = [];
  let run: Descendant[] = [];
  let runBytes = shell;
  for (const child of children) {
    const size = bytesOf(child) + 1;
    if (run.length > 0 && runBytes + size > CUT_BUDGET) {
      parts.push({ ...element, children: run });
      run = [];
      runBytes = shell;
    }
    run.push(child);
    runBytes += size;
  }
  if (run.length > 0) {
    parts.push({ ...element, children: run });
  }
  return parts;
};

const refusalOf = (element: TElement, reason: string): RefusedBlock => ({
  reason,
  text: NodeApi.string(element),
});

// every draft named and parsed; one past the cap cut first, its `ref` kept by its first part
export const nameDrafts = (
  drafts: readonly DraftBlock[],
  newBlockId: () => string,
): NamedBlocks => {
  const blocks: LibraryBlock[] = [];
  const refused: RefusedBlock[] = [];
  for (const draft of drafts) {
    const parts = bytesOf(draft.element) > CUT_BUDGET ? cutElement(draft.element) : [draft.element];
    for (const [index, element] of parts.entries()) {
      const json = namedBlockJson({ element, ref: index === 0 ? draft.ref : null }, newBlockId());
      const parsed = storableBlockSchema.safeParse(json);
      if (parsed.success) {
        blocks.push(parsed.data);
      } else {
        refused.push(refusalOf(element, parsed.error.issues[0]?.message ?? "not storable"));
      }
    }
  }
  return { blocks, refused };
};
