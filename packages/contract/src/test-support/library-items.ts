// Items, blocks and ops for the library model's suites, built by hand.

import { blockHash } from "../library/block-hash";
import { applyOps } from "../library/block-ops";
import type { ItemState, LibraryOp, StoredBlock } from "../library/block-ops";
import { ordsBetween } from "../library/order-key";
import type { LibraryItemFields } from "../library/library-item";
import type { LibraryBlock, LibrarySection } from "../library/library-nodes";

/** @internal */
export const noteFields = (overrides: Partial<LibraryItemFields> = {}): LibraryItemFields => ({
  aliases: [],
  author: null,
  coverSha: null,
  deletedAt: null,
  description: null,
  fetchError: null,
  fetchState: "none",
  fetchedAt: null,
  folderId: null,
  kind: "note",
  lang: null,
  originalName: null,
  originalSha: null,
  pinnedAt: null,
  properties: {},
  published: null,
  savedAt: 1_700_000_000_000,
  site: null,
  tags: [],
  title: "A note",
  url: null,
  ...overrides,
});

/** @internal */
export const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

const stored = (
  block: LibraryBlock,
  ord: string,
  section: LibrarySection = "note",
): StoredBlock => ({ block, hash: blockHash(block), ord, section });

// an item whose blocks sit in the order given, keyed as the library mints keys
/** @internal */
export const itemOf = (
  blocks: readonly LibraryBlock[],
  fields: LibraryItemFields = noteFields(),
  section: LibrarySection = "note",
): ItemState => {
  const keys = ordsBetween(null, null, blocks.length);
  return {
    blocks: new Map(
      blocks.map((block, index) => [block.id, stored(block, keys[index] ?? "a0", section)]),
    ),
    fields,
  };
};

/** @internal */
export const landed = (state: ItemState, ops: readonly LibraryOp[]): ItemState => {
  const outcome = applyOps(state, ops);
  if (outcome.kind !== "applied") {
    throw new Error(`ops did not land: ${JSON.stringify(outcome)}`);
  }
  return outcome.state;
};
