import { urlKey } from "@repo/contract/items/item-url";
import type { ParentTarget } from "@repo/contract/library/cell-rules";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { pageFields, stubFields } from "@repo/contract/library/item-makes";
import { takesRead, withPage } from "@repo/contract/library/item-reading";
import type { ReadPage } from "@repo/contract/library/item-reading";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { liveItemRowSchema } from "@repo/contract/library/library-wire";
import { z } from "zod";

import { withArticle } from "./article-body";
import { noteBlocksOf } from "./library-codec";
import { askFills } from "./library-fills";
import { parentOfTarget } from "./library-parents";
import { mintLibraryId } from "./library-ids";
import { landNew } from "./library-items";
import { landItem } from "./library-landing";
import type { LiveItemRow } from "./library-landing";
import { liveItemAt, readBodyFacts, readItemWhole } from "./library-rows";
import type { WriteScope } from "./library-store";
import { liveRowOf } from "./library-writes";

export const savedSchema = z.object({ created: z.boolean(), item: liveItemRowSchema });

interface SavedItem {
  readonly created: boolean;
  readonly item: LiveItemRow;
}

const heldItem = async (scope: WriteScope, url: string) => {
  const key = urlKey(url);

  return key === null ? null : await liveItemAt(scope.tx, scope.accountId, key);
};

const noteOf = async (scope: WriteScope, words: string | undefined) =>
  (words === undefined || words.trim() === ""
    ? []
    : await noteBlocksOf(scope, words)) satisfies readonly BodyBlock[];

interface SavePageInput extends ReadPage {
  readonly id: string;
  readonly url: string;
  readonly article: readonly LibraryBlock[];
  readonly parentId: string | null;
  readonly note?: string | undefined;
  readonly savedAt: number;
  readonly tags: readonly string[];
}

export const savePage = async (scope: WriteScope, input: SavePageInput) => {
  const held = await heldItem(scope, input.url);

  if (held === null) {
    const note = await noteOf(scope, input.note);

    return {
      created: true,
      item: await landNew(scope, {
        blocks: withArticle(note, input.article),
        fields: pageFields(input, scope.now),
        id: input.id,
      }),
    } satisfies SavedItem;
  }

  const facts = await readBodyFacts(scope.tx, scope.accountId, held.id);

  const whole =
    facts !== null && takesRead(held.fields.reading, facts.digest.article, input)
      ? await readItemWhole(scope.tx, scope.accountId, held.id)
      : null;

  if (whole === null) {
    return { created: false, item: liveRowOf(held) } satisfies SavedItem;
  }

  return {
    created: false,
    item: await landItem(scope, {
      before: whole.item,
      body: withArticle(whole.blocks, input.article),
      fields: withPage(whole.item.fields, input, scope.now),
      itemId: held.id,
    }),
  } satisfies SavedItem;
};

interface SaveLinkInput {
  readonly url: string;
  readonly id?: string | undefined;
  readonly note?: string | undefined;
  readonly parent?: ParentTarget | undefined;
  readonly savedAt?: number | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly title?: string | undefined;
}

export const saveLink = async (scope: WriteScope, input: SaveLinkInput) => {
  const held = await heldItem(scope, input.url);

  if (held !== null) {
    return { created: false, item: liveRowOf(held) } satisfies SavedItem;
  }

  const id = input.id ?? mintLibraryId(scope.now);
  const parentId = await parentOfTarget(scope, input.parent, [{ id, kind: "link" }]);

  const stub = await landNew(scope, {
    blocks: await noteOf(scope, input.note),
    fields: stubFields({
      parentId: parentId ?? null,
      savedAt: input.savedAt ?? scope.now,
      tags: input.tags ?? [],
      title: input.title,
      url: input.url,
    }),
    id,
  });

  await askFills(scope, [stub]);

  return { created: true, item: stub } satisfies SavedItem;
};
