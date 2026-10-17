// saving and filling items. every write answers the vault paths it wrote, so the router can
// attribute them to an agent's turn: an agent's `inteligir save` joins its turn, and Undo removes
// the whole item (stub, cover, copy and both sides of a rename).

import type { DbConnection } from "@repo/db/connection";
import type {
  ItemFill,
  ItemTagResult,
  itemsRefreshRequestSchema,
  itemsSaveFileRequestSchema,
  itemsSaveLinkRequestSchema,
  itemsSavePageRequestSchema,
  itemsTagRequestSchema,
} from "@repo/contract/local/items/items-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { z } from "zod";

import type { AnnotationsService } from "../annotations/annotations-service";
import type { DebugLog } from "../debug-log";
import type { ImageDownscale } from "../media/image-downscale";
import { createCapture } from "./capture/capture";
import type { CaptureDeps } from "./capture/capture";
import type { CapturePorts } from "./capture/capture-ports";
import { createItemCore } from "./item-core";
import type { ItemCore, ItemCoreDeps } from "./item-core";
import { tagItems } from "./item-tags";
import { saveFileItem } from "./save-file";

export type SaveLinkInput = z.output<typeof itemsSaveLinkRequestSchema>;
export type SavePageInput = z.output<typeof itemsSavePageRequestSchema>;
export type RefreshInput = z.output<typeof itemsRefreshRequestSchema>;

export interface SaveOutcome {
  outcome: "created" | "exists";
  path: string;
  fill: ItemFill;
  wrote: string[];
}

export interface ItemsService {
  saveLink: (input: SaveLinkInput) => Promise<SaveOutcome>;
  savePage: (input: SavePageInput) => Promise<SaveOutcome>;
  saveFile: (input: z.output<typeof itemsSaveFileRequestSchema>) => Promise<SaveOutcome>;
  refresh: (input: RefreshInput) => Promise<{ path: string; fill: ItemFill; wrote: string[] }>;
  tag: (
    input: z.output<typeof itemsTagRequestSchema>,
  ) => Promise<{ results: ItemTagResult[]; wrote: string[] }>;
  // the import's hand-off to the fill. `cover`: Raindrop's recorded cover url
  enqueueFill: (
    item: { id: string; path: string; url: string },
    hints?: { cover?: string },
  ) => void;
  // a stub the person wrote back through this Mac (a restore from Deleted or History, an Undo)
  // is filled again as this Mac's own; never throws
  adoptOwn: (paths: readonly string[]) => Promise<void>;
  // imports share the url locks
  readonly core: ItemCore;
  // compose calls it off the critical path, beside the thread origins' repair
  boot: () => void;
  dispose: () => Promise<void>;
}

export interface ItemsServiceDeps extends ItemCoreDeps {
  // the capture's reads besides the core's: the stubs a sweep may fill, and where an item went
  knowledge: CaptureDeps["knowledge"];
  annotations: AnnotationsService;
  // the vault's inteligir.db: pending_fills and the shuffle seed
  db: DbConnection;
  dataDir: string;
  debugLog: DebugLog | undefined;
  version: string;
  // set by serve.ts after listen
  ownPort: () => number | null;
  downscale: ImageDownscale;
  // ComposePorts.items
  ports?: CapturePorts | undefined;
}

export const createItemsService = (deps: ItemsServiceDeps): ItemsService => {
  const core = createItemCore(deps);
  const capture = createCapture({
    annotations: deps.annotations,
    core,
    dataDir: deps.dataDir,
    db: deps.db,
    debugLog: deps.debugLog,
    downscale: deps.downscale,
    knowledge: deps.knowledge,
    ownPort: deps.ownPort,
    ports: deps.ports ?? {},
    version: deps.version,
  });
  return {
    adoptOwn: async (paths) => {
      for (const path of paths.filter((candidate) => isDocPath(candidate))) {
        try {
          await capture.adoptOwn(path);
        } catch (error) {
          deps.debugLog?.(
            `adopting ${path} failed: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }
    },
    boot: () => {
      capture.boot();
    },
    core,
    dispose: async () => {
      await capture.dispose();
    },
    enqueueFill: (item, hints) => {
      capture.enqueue(item, hints);
    },
    refresh: async (input) => await capture.refresh(input),
    saveFile: async (input) => await saveFileItem(core, input),
    saveLink: async (input) => await capture.saveLink(input),
    savePage: async (input) => await capture.savePage(input),
    tag: async (input) => await tagItems(core, input),
  };
};
