import { utf8ByteLength } from "@repo/contract/library/canonical-json";
import { sameBody } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { BODY_MAX_BYTES } from "@repo/contract/library/library-wire";
import type { bodyWriteSchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";

import { landItem } from "../library/library-landing";
import { refuse } from "../library/library-refusal";
import { readItemRow, readItemWhole } from "../library/library-rows";
import type { WriteScope } from "../library/library-store";

type BodyWrite = z.output<typeof bodyWriteSchema>;

export interface BodySave {
  readonly itemId: string;
  readonly baseVersion: number;
  readonly blocks: readonly BodyBlock[];
}

export const writeBody = async (scope: WriteScope, save: BodySave) => {
  const { accountId, tx } = scope;
  const { baseVersion, blocks, itemId } = save;
  const held = await readItemRow(tx, accountId, itemId);

  if (held === null) {
    return refuse({ kind: "not-found" });
  }

  const { bodyVersion, item } = held;

  if (item.fields.deletedAt !== null) {
    return { kind: "deleted" } satisfies BodyWrite;
  }

  if (utf8ByteLength(JSON.stringify(blocks)) > BODY_MAX_BYTES) {
    return { kind: "full", maxBytes: BODY_MAX_BYTES } satisfies BodyWrite;
  }

  if (bodyVersion !== baseVersion) {
    const whole = await readItemWhole(tx, accountId, itemId);

    return (
      whole !== null && sameBody(whole.blocks, blocks)
        ? { kind: "saved", seq: item.seq, version: bodyVersion }
        : { kind: "stale", version: bodyVersion }
    ) satisfies BodyWrite;
  }

  const landed = await landItem(scope, { before: item, body: blocks, fields: item.fields, itemId });

  return { kind: "saved", seq: landed.seq, version: baseVersion + 1 } satisfies BodyWrite;
};
