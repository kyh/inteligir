// Saving a web address: one url, one item. A save of an address a live item holds answers that
// item as it stands and writes nothing, unless it is a page a device read itself (the extension)
// and the item takes the read (`takesRead`): then the read lands on it as a reading does. Only an
// address no live item holds makes an item. A page a device read lands read; one saved to read
// later lands at once as an unread stub, `pending`, asking the cloud to read it in the same write
// (`./library-fills`), so a save calls no model and waits on no page. The words saved with it go
// in the new item's note.

import { urlKey } from "@repo/contract/items/item-url";
import type { FolderTarget } from "@repo/contract/library/cell-rules";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { pageFields, stubFields } from "@repo/contract/library/item-makes";
import { takesRead, withPage } from "@repo/contract/library/item-reading";
import type { ReadPage } from "@repo/contract/library/item-reading";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { liveItemRowSchema } from "@repo/contract/library/library-wire";
import { z } from "zod";

import { withArticle } from "../body/article-body";
import { noteBlocksOf } from "./library-codec";
import { askFills } from "./library-fills";
import { folderOfTarget } from "./library-folders";
import { mintLibraryId } from "./library-ids";
import { landNew } from "./library-items";
import { landItem } from "./library-landing";
import type { LiveItemRow } from "./library-landing";
import { liveItemAt, readBodyFacts, readItemWhole } from "./library-rows";
import type { StoredItem } from "./library-rows";
import type { WriteScope } from "./library-store";
import { liveRowOf } from "./library-writes";

// what a save answers: `created` false when the library already held the address, and this is
// that item
export const savedSchema = z.object({ created: z.boolean(), item: liveItemRowSchema });

interface SavedItem {
  readonly created: boolean;
  readonly item: LiveItemRow;
}

// the live item a url's key names, if one does
const heldItem = async (scope: WriteScope, url: string): Promise<StoredItem | null> => {
  const key = urlKey(url);
  return key === null ? null : await liveItemAt(scope.tx, scope.accountId, key);
};

// the words a save brought, read into note blocks; blank words are none
const noteOf = async (
  scope: WriteScope,
  words: string | undefined,
): Promise<readonly BodyBlock[]> =>
  words === undefined || words.trim() === "" ? [] : await noteBlocksOf(scope, words);

interface SavePageInput extends ReadPage {
  readonly id: string;
  readonly url: string;
  readonly article: readonly LibraryBlock[];
  readonly folderId: string | null;
  readonly note?: string | undefined;
  readonly savedAt: number;
  readonly tags: readonly string[];
}

// a page the device read: a new read item, or the item that holds its address, as it stands
// unless it takes the read
export const savePage = async (scope: WriteScope, input: SavePageInput): Promise<SavedItem> => {
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
    };
  }
  // a read the item takes in place of none it had, so its body holds its note alone
  const facts = await readBodyFacts(scope.tx, scope.accountId, held.id);
  const whole =
    facts !== null && takesRead(held.fields.reading, facts.digest.article, input)
      ? await readItemWhole(scope.tx, scope.accountId, held.id)
      : null;
  if (whole === null) {
    return { created: false, item: liveRowOf(held) };
  }
  return {
    created: false,
    item: await landItem(scope, {
      before: whole.item,
      body: withArticle(whole.blocks, input.article),
      fields: withPage(whole.item.fields, input, scope.now),
      itemId: held.id,
    }),
  };
};

interface SaveLinkInput {
  readonly url: string;
  readonly id?: string | undefined;
  readonly note?: string | undefined;
  readonly folder?: FolderTarget | undefined;
  readonly savedAt?: number | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly title?: string | undefined;
}

// a url to read later: the item that holds it as it stands, else an unread stub, its reading
// asked for in the same write
export const saveLink = async (scope: WriteScope, input: SaveLinkInput): Promise<SavedItem> => {
  const held = await heldItem(scope, input.url);
  if (held !== null) {
    return { created: false, item: liveRowOf(held) };
  }
  const folderId = await folderOfTarget(scope, input.folder);
  const stub = await landNew(scope, {
    blocks: await noteOf(scope, input.note),
    fields: stubFields({
      folderId: folderId ?? null,
      savedAt: input.savedAt ?? scope.now,
      tags: input.tags ?? [],
      title: input.title,
      url: input.url,
    }),
    id: input.id ?? mintLibraryId(scope.now),
  });
  await askFills(scope, [stub]);
  return { created: true, item: stub };
};
