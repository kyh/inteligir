// The one wire as an app calls it, `/v1/rpc` and `/v1/blobs/<sha>`, against a booted Worker; and
// what an account still holds there, read through the Worker host's own door rather than the
// Worker, which describes no deleted account (`./worker-host.ts`).

import { createHash } from "node:crypto";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { clientBuildHeaders } from "@repo/contract/cloud/client-build";
import { V1_BLOBS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { uuidV7 } from "@repo/notes/library/uuid-v7";
import { z } from "zod";
import { PHONE_BUILD } from "./cloud-account";
import type { CloudWorker } from "./cloud-worker";

// the headers a phone at this checkout's build sends, with its credential when it has one
const phoneHeaders = (credential: string | null): Headers => {
  const headers = new Headers(clientBuildHeaders(PHONE_BUILD));
  if (credential !== null) {
    headers.set("authorization", `Bearer ${credential}`);
  }
  return headers;
};

export const v1Client = (worker: CloudWorker, credential: string | null): V1Client =>
  createORPCClient<V1Client>(
    new RPCLink({ headers: phoneHeaders(credential), origin: worker.origin, url: V1_RPC_PATH }),
  );

// a file's bytes uploaded at the sha they hash to, as the apps upload one; its sha
export const uploadFile = async (
  worker: CloudWorker,
  credential: string,
  file: { readonly bytes: Uint8Array<ArrayBuffer>; readonly type: string },
): Promise<{ readonly sha: string; readonly status: number }> => {
  const sha = createHash("sha256").update(file.bytes).digest("hex");
  const headers = phoneHeaders(credential);
  headers.set("content-type", file.type);
  const response = await fetch(`${worker.origin}${V1_BLOBS_PATH}/${sha}`, {
    body: file.bytes,
    headers,
    method: "PUT",
  });
  await response.arrayBuffer();
  return { sha, status: response.status };
};

// a file's bytes as an app reads them, with the request's own headers (a range, say)
export const readFile = async (
  worker: CloudWorker,
  credential: string,
  sha: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> => {
  const asked = phoneHeaders(credential);
  for (const [name, value] of Object.entries(headers)) {
    asked.set(name, value);
  }
  return await fetch(`${worker.origin}${V1_BLOBS_PATH}/${sha}`, { headers: asked });
};

// an item's every field as the change log last wrote it, read the way a replica pulls it, or null
// for an item it holds no live row of
export const itemFieldsOf = async (
  library: V1Client["library"],
  id: string,
): Promise<LibraryItemFields | null> => {
  let fields: LibraryItemFields | null = null;
  let cursor = 0;
  for (;;) {
    const page = await library.sync.pull({ cursor, epoch: null });
    if (page.kind === "reset") {
      throw new Error("the change log answered a reset to a pull from its start");
    }
    for (const change of page.changes) {
      if (change.kind === "item" && change.id === id) {
        fields = change.row.kind === "live" ? change.row.fields : null;
      }
    }
    if (!page.more) {
      return fields;
    }
    cursor = page.upto;
  }
};

const accountIdSchema = z.object({ accountId: z.string().nullable() });

export const accountIdOf = async (worker: CloudWorker, email: string): Promise<string | null> => {
  const response = await fetch(
    `${worker.inspectOrigin}/account?email=${encodeURIComponent(email)}`,
  );
  return accountIdSchema.parse(await response.json()).accountId;
};

const holdingsSchema = z.object({
  cell: z.object({ deleted: z.number().nullable(), items: z.number().int() }),
  files: z.number().int(),
  rows: z.object({
    devices: z.number().int(),
    sessions: z.number().int(),
    users: z.number().int(),
  }),
});

export type AccountHoldings = z.infer<typeof holdingsSchema>;

// the account's library cell (its items, and when it was deleted), its files in R2 and its rows
export const holdingsOf = async (
  worker: CloudWorker,
  accountId: string,
): Promise<AccountHoldings> => {
  const response = await fetch(`${worker.inspectOrigin}/account/${encodeURIComponent(accountId)}`);
  if (!response.ok) {
    throw new Error(`the worker host read nothing of ${accountId}: ${await response.text()}`);
  }
  return holdingsSchema.parse(await response.json());
};

// an id a device mints for an item or folder it creates, as every writer mints one
export const newItemId = (now: number = Date.now()): string =>
  uuidV7(now, crypto.getRandomValues(new Uint8Array(16)));
