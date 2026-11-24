import type { Descendant, TElement } from "platejs";

import { canonicalJson } from "@repo/contract/library/canonical-json";
import { utf8ByteLength } from "@repo/contract/bytes";
import { BLOCK_MAX_BYTES, storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { libraryJsonOf, namedBlockJson } from "./read-blocks";
import type { DraftBlock } from "./read-blocks";
import { isText, leaf, marksOf } from "./slate-leaves";

export interface NamedBlocks {
  readonly blocks: readonly LibraryBlock[];
  readonly refused: number;
}

const CUT_BUDGET = BLOCK_MAX_BYTES - 4096;
const UNITS_PER_PIECE = Math.floor(CUT_BUDGET / 6);

const bytesOf = (node: Descendant) => utf8ByteLength(canonicalJson(libraryJsonOf(node)));

const LOW_SURROGATE_MIN = 0xdc_00;
const LOW_SURROGATE_MAX = 0xdf_ff;

const textPieces = (text: string) => {
  const pieces: string[] = [];
  let rest = text;

  while (rest.length > UNITS_PER_PIECE) {
    const lineEnd = rest.lastIndexOf("\n", UNITS_PER_PIECE);
    let at = lineEnd > UNITS_PER_PIECE / 2 ? lineEnd + 1 : UNITS_PER_PIECE;
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

const cutElement = (element: TElement) => {
  const children = element.children.flatMap<Descendant>((child) => {
    if (isText(child)) {
      const marks = marksOf(child);

      return textPieces(child.text).map((piece) => leaf(piece, marks));
    }

    return bytesOf(child) > CUT_BUDGET ? cutElement(child) : [child];
  });

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

export const nameDrafts = (drafts: readonly DraftBlock[], newBlockId: () => string) => {
  const blocks: LibraryBlock[] = [];
  let refused = 0;

  for (const draft of drafts) {
    const parts = bytesOf(draft.element) > CUT_BUDGET ? cutElement(draft.element) : [draft.element];

    for (const element of parts) {
      const json = namedBlockJson({ element }, newBlockId());
      const parsed = storableBlockSchema.safeParse(json);

      if (parsed.success) {
        blocks.push(parsed.data);
      } else {
        refused += 1;
      }
    }
  }

  return { blocks, refused } satisfies NamedBlocks;
};
