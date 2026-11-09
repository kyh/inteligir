// An item as the cell answers it, for a suite that answers the page's reads itself: a listing's row
// (`library.listing.page`) and the whole item (`library.items.get`).

import type { InferClientOutputs } from "@orpc/client";
import type { V1Client } from "@repo/contract/v1";
import { blankItemFields } from "@repo/contract/library/item-makes";
import type { LibraryItemFields } from "@repo/contract/library/library-item";

import type { ListedItem } from "../library/listing";

type HeldItem = InferClientOutputs<V1Client>["library"]["items"]["get"];

const SAVED = 1_700_000_000_000;

export const listedItem = (
  id: string,
  patch: Partial<LibraryItemFields> = {},
  seq = 1,
): ListedItem => {
  const fields = { ...blankItemFields(SAVED), ...patch };
  return {
    card: { outline: [], preview: "", title: fields.title, words: 0 },
    fields,
    id,
    seq,
    tags: fields.tags,
    updatedAt: SAVED,
  };
};

export const heldItem = (
  id: string,
  patch: Partial<LibraryItemFields> = {},
  seq = 1,
): HeldItem => ({ ...listedItem(id, patch, seq), blocks: [], kind: "live" });
