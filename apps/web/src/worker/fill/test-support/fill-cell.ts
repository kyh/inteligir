// What a fill suite stands on: an account's cell holding a link saved to read later, the queue's
// message for it, the web the consumer reads served by a stand-in for the platform's fetch, and
// the item read back as the cell holds it.

import type { ItemState } from "@repo/notes/library/block-ops";
import { readItemState } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import { createRouterClient } from "@orpc/server";
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";

import worker from "../../index";
import { openCellLibrary } from "../../library/cell-library";
import { cellStorageOf } from "../../library/cell-storage";
import type { LibraryEngine } from "../../library/library-engine";
import type { Principal } from "../../library/library-principal";
import { libraryRouter } from "../../library/library-router";
import { cellOf, inCell, newAccountId } from "../../test-support/library-cell";
import type { FillJob } from "../fill-job";
import { FILL_QUEUE } from "../fill-queues";

const laptop = (accountId: string): Principal => ({
  accountId,
  actor: { deviceId: "laptop-1", deviceName: "Laptop", kind: "device" },
  scopes: ["library"],
});

// the account's library as the apps call it, over its own cell
export const libraryIn = (
  state: DurableObjectState,
  accountId: string,
  library: LibraryEngine = openCellLibrary(state, env),
) =>
  createRouterClient(libraryRouter, {
    context: {
      library,
      principal: laptop(accountId),
      settle: async (result) => await Promise.resolve(result),
    },
  });

export interface SavedLink {
  readonly accountId: string;
  readonly itemId: string;
  readonly job: FillJob;
}

// a link saved to read later in a fresh account, and the reading its save asked for
export const savedLink = async (url: string): Promise<SavedLink> => {
  const accountId = newAccountId();
  const saved = await inCell(cellOf(accountId), async (state) =>
    libraryIn(state, accountId).items.saveLink({ url }),
  );
  return {
    accountId,
    itemId: saved.item.id,
    job: { accountId, coverHint: null, itemId: saved.item.id, url: saved.item.fields.url ?? url },
  };
};

export const itemIn = async (accountId: string, itemId: string): Promise<ItemState | null> =>
  await inCell(cellOf(accountId), (state) =>
    runPlan(cellStorageOf(state.storage), readItemState(itemId)),
  );

export const fieldsIn = async (accountId: string, itemId: string) => {
  const state = await itemIn(accountId, itemId);
  return state?.fields ?? null;
};

export const textOfSection = (state: ItemState | null, section: "note" | "article"): string =>
  JSON.stringify(
    [...(state?.blocks.values() ?? [])]
      .filter((stored) => stored.section === section)
      .map((stored) => stored.block),
  );

export interface Delivered {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly delaySeconds: number | null;
}

// one message handed to the Worker's queue handler as the queue would, and what became of it
export const deliver = async (
  body: Readonly<Record<string, string | null>>,
  options: { readonly attempts?: number; readonly queue?: string } = {},
): Promise<Delivered> => {
  const batch = createMessageBatch(options.queue ?? FILL_QUEUE, [
    { attempts: options.attempts ?? 1, body, id: "message-1", timestamp: new Date() },
  ]);
  const [message] = batch.messages;
  const retry = message === undefined ? null : vi.spyOn(message, "retry");
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  const result = await getQueueResult(batch, ctx);
  const delay = retry?.mock.calls[0]?.[0]?.delaySeconds;
  return {
    acked: result.explicitAcks.includes("message-1"),
    delaySeconds: delay ?? null,
    retried: result.retryMessages.length > 0,
  };
};

export type Route = () => Response;

// the web as the consumer's fetch meets it: each address a route, every other one a 404; every
// address asked is kept, in order, with the headers it was asked with
export const serveWeb = (routes: Readonly<Record<string, Route>>) => {
  const asked: { readonly url: string; readonly headers: Headers }[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    asked.push({ headers: request.headers, url: request.url });
    const route = routes[request.url];
    return await Promise.resolve(
      route === undefined ? new Response("missing", { status: 404 }) : route(),
    );
  });
  return { asked, spy };
};

export const htmlPage =
  (html: string, status = 200): Route =>
  () =>
    new Response(html, { headers: { "content-type": "text/html; charset=utf-8" }, status });

// a PNG's signature and header naming its size, which is all the reading looks at
export const pngOf = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
};

export const filePage =
  (bytes: Uint8Array, type: string): Route =>
  () =>
    new Response(bytes, { headers: { "content-type": type } });
