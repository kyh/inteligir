// A note's body written whole over the version its writer read it at: a person's save, and an
// agent's edit once it is made (`./edit-body`). It runs inside a write, under the account's lock,
// so comparing the version it names with the one the body stands at and writing it are one step no
// other write comes between, and nothing is held while a writer works: a body written since
// answers `stale`, and its writer merges or reads again. A save sent twice, its first answer lost,
// finds its own blocks there and is answered as saved. The landing derives the rest
// (`../library/library-landing`): the card, search row, tags and links, the item's sequence, and
// the agent's turn's change set.

import { sameJson, utf8ByteLength } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { BODY_MAX_BYTES } from "@repo/contract/library/library-wire";
import type { bodyWriteSchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";

import { landItem } from "../library/library-landing";
import { refuse } from "../library/library-refusal";
import { readItemRow, readItemWhole } from "../library/library-rows";
import type { WriteScope } from "../library/library-store";

export type BodyWrite = z.output<typeof bodyWriteSchema>;

const sameBlocks = (a: readonly BodyBlock[], b: readonly BodyBlock[]): boolean =>
  a.length === b.length &&
  a.every((one, at) => {
    const other = b[at];
    return other !== undefined && one.section === other.section && sameJson(one.block, other.block);
  });

export interface BodySave {
  readonly itemId: string;
  // the version the writer read the body at
  readonly baseVersion: number;
  readonly blocks: readonly BodyBlock[];
}

// the body as `save` holds it, when it stands where the writer read it; an item emptied from
// Deleted, or never made, is refused as not found
export const writeBody = async (scope: WriteScope, save: BodySave): Promise<BodyWrite> => {
  const { accountId, tx } = scope;
  const { baseVersion, blocks, itemId } = save;
  const held = await readItemRow(tx, accountId, itemId);
  if (held === null) {
    return refuse({ kind: "not-found" });
  }
  const { bodyVersion, item } = held;
  if (item.fields.deletedAt !== null) {
    return { kind: "deleted" };
  }
  if (utf8ByteLength(JSON.stringify(blocks)) > BODY_MAX_BYTES) {
    return { kind: "full", maxBytes: BODY_MAX_BYTES };
  }
  if (bodyVersion !== baseVersion) {
    const whole = await readItemWhole(tx, accountId, itemId);
    return whole !== null && sameBlocks(whole.blocks, blocks)
      ? { kind: "saved", seq: item.seq, version: bodyVersion }
      : { kind: "stale", version: bodyVersion };
  }
  const landed = await landItem(scope, { before: item, body: blocks, fields: item.fields, itemId });
  // the landing writes the body one past the version it stands at, which is this one
  return { kind: "saved", seq: landed.seq, version: baseVersion + 1 };
};
