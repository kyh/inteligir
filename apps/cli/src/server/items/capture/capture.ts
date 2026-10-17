// saving a link or a page: the stub is written at once, under the url key's lock, and the fill
// reads the page afterwards. a save of a url the library holds answers `exists` with that item.

import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { DbConnection } from "@repo/db/connection";
import type { ItemFill } from "@repo/contract/local/items/items-schema";
import { clipQuote, mintAnnotationId } from "@repo/notes/annotations/store-schema";
import { UNSORTED_FOLDER } from "@repo/notes/items/item-kind";
import { itemStem } from "@repo/notes/items/item-name";
import { linkStubText } from "@repo/notes/items/item-stub";
import { urlKey } from "@repo/notes/items/item-url";

import type { AnnotationsService } from "../../annotations/annotations-service";
import type { DebugLog } from "../../debug-log";
import type { KnowledgeRuntime } from "../../knowledge/knowledge-runtime";
import type { ImageDownscale } from "../../media/image-downscale";
import type { ItemCore } from "../item-core";
import type { RefreshInput, SaveLinkInput, SaveOutcome, SavePageInput } from "../items-service";
import type { CapturePorts } from "./capture-ports";

export interface CaptureDeps {
  // its git reads (isTracked, creatorOf) and its syncNow/commitPaths
  core: ItemCore;
  knowledge: Pick<
    KnowledgeRuntime,
    "settle" | "findByUrl" | "itemsAt" | "itemStubs" | "pathForNoteId"
  >;
  annotations: Pick<AnnotationsService, "add" | "placeWaiting">;
  // pending_fills and the `meta` row `fill-shuffle-seed`
  db: DbConnection;
  dataDir: string;
  debugLog: DebugLog | undefined;
  version: string;
  ownPort: () => number | null;
  downscale: ImageDownscale;
  ports: CapturePorts;
}

export interface Capture {
  saveLink: (input: SaveLinkInput) => Promise<SaveOutcome>;
  savePage: (input: SavePageInput) => Promise<SaveOutcome>;
  refresh: (input: RefreshInput) => Promise<{ path: string; fill: ItemFill; wrote: string[] }>;
  // an own pending entry, the import's hand-off
  enqueue: (item: { id: string; path: string; url: string }, hints?: { cover?: string }) => void;
  boot: () => void;
  dispose: () => Promise<void>;
}

const PENDING: ItemFill = { state: "pending" };

interface StubRequest {
  url: string;
  title: string | null;
  folder: string | undefined;
  tags: readonly string[] | undefined;
}

// PIVOT-STUB(S1): replaced by the guarded fetch and the fill pipeline (§4.4); this writes the stub
// and reads nothing
export const createCapture = (deps: CaptureDeps): Capture => {
  const { core } = deps;

  // the stub, or the item already holding the url's key
  const stubFor = async (request: StubRequest): Promise<SaveOutcome> => {
    const found = await core.existing(request.url);
    if (found !== null) {
      // PIVOT-STUB(S1): the request's tags and keepCopy are added to the existing item (§4.4 point 16)
      return { fill: found.fill, outcome: "exists", path: found.path, wrote: [] };
    }
    const stub: Parameters<typeof linkStubText>[0] = {
      id: core.newId(),
      note: "",
      saved: core.now().getTime(),
      url: request.url,
    };
    if (request.tags !== undefined) {
      stub.tags = request.tags;
    }
    const created = await core.createDoc({
      content: linkStubText(stub),
      folder: request.folder ?? UNSORTED_FOLDER,
      stem: itemStem(request.title, request.url),
    });
    return { fill: PENDING, outcome: "created", path: created.path, wrote: [created.path] };
  };

  const locked = async (url: string, run: () => Promise<SaveOutcome>): Promise<SaveOutcome> =>
    await core.withUrlLock(urlKey(url) ?? url, run);

  return {
    boot: () => {
      /* PIVOT-STUB(S1): no pending fill to re-queue yet */
    },

    dispose: async () => {
      await Promise.resolve();
    },

    enqueue: () => {
      /* PIVOT-STUB(S1): no fill runs yet */
    },

    refresh: () => Promise.reject(new ORPCError("NOT_IMPLEMENTED", { message: "PIVOT-STUB(S1)" })),

    saveLink: async (input) =>
      await locked(
        input.url,
        async () =>
          await stubFor({
            folder: input.folder,
            tags: input.tags,
            title: input.title ?? null,
            url: input.url,
          }),
      ),

    // a selection is a highlight waiting for the page's text, on the item created or held
    savePage: async (input) =>
      await locked(input.page.url, async () => {
        const saved = await stubFor({
          folder: input.folder,
          tags: input.tags,
          title: input.page.title,
          url: input.page.url,
        });
        if (input.page.selection === null) {
          return saved;
        }
        const highlight = await deps.annotations.add({
          id: mintAnnotationId(randomBytes),
          path: saved.path,
          quote: clipQuote(input.page.selection.text),
          source: "user",
          text: "",
        });
        return { ...saved, wrote: [...saved.wrote, ...highlight.wrote] };
      }),
  };
};
