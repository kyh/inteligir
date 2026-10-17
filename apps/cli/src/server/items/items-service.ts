// saving and filling items. every write answers the vault paths it wrote, so the router can
// attribute them to an agent's turn: an agent's `inteligir save` joins its turn, and Undo removes
// the whole item (stub, cover, copy and both sides of a rename).

import { ORPCError } from "@orpc/server";
import type {
  ItemFill,
  ItemTagResult,
  itemsRefreshRequestSchema,
  itemsSaveFileRequestSchema,
  itemsSaveLinkRequestSchema,
  itemsSavePageRequestSchema,
  itemsTagRequestSchema,
} from "@repo/contract/local/items/items-schema";
import type { z } from "zod";

interface SaveOutcome {
  outcome: "created" | "exists";
  path: string;
  fill: ItemFill;
  wrote: string[];
}

export interface ItemsService {
  saveLink: (input: z.output<typeof itemsSaveLinkRequestSchema>) => Promise<SaveOutcome>;
  savePage: (input: z.output<typeof itemsSavePageRequestSchema>) => Promise<SaveOutcome>;
  saveFile: (input: z.output<typeof itemsSaveFileRequestSchema>) => Promise<SaveOutcome>;
  refresh: (
    input: z.output<typeof itemsRefreshRequestSchema>,
  ) => Promise<{ path: string; fill: ItemFill; wrote: string[] }>;
  tag: (
    input: z.output<typeof itemsTagRequestSchema>,
  ) => Promise<{ results: ItemTagResult[]; wrote: string[] }>;
  // the import's hand-off to the fill. `cover`: Raindrop's recorded cover url
  enqueueFill: (
    item: { id: string; path: string; url: string },
    hints?: { cover?: string },
  ) => void;
  // compose calls it off the critical path, beside the thread origins' repair
  boot: () => void;
  dispose: () => Promise<void>;
}

const unbuilt = (): Promise<never> =>
  Promise.reject(new ORPCError("NOT_IMPLEMENTED", { message: "PIVOT-STUB(F)" }));

// PIVOT-STUB(F): the foundation's server step builds the service over the item core (§4.3)
export const createItemsService = (): ItemsService => ({
  boot: () => {
    /* nothing pending yet */
  },
  dispose: () => Promise.resolve(),
  enqueueFill: () => {
    /* no fill runs yet */
  },
  refresh: () => unbuilt(),
  saveFile: () => unbuilt(),
  saveLink: () => unbuilt(),
  savePage: () => unbuilt(),
  tag: () => unbuilt(),
});
