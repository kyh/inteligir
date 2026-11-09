// The one wire as an app calls it, `/v1/rpc` and `/v1/blobs/<sha>`, against a booted Worker; and
// what an account still holds there, read through the Worker host's own door rather than the
// Worker, which describes no deleted account (`./worker-host.ts`).

import { createHash } from "node:crypto";
import { createORPCClient, isDefinedError, safe } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { clientBuildHeaders } from "@repo/contract/cloud/client-build";
import { V1_BLOBS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { PHONE_ORIGIN } from "@repo/contract/cloud/origin";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { uuidV7 } from "@repo/notes/library/uuid-v7";
import { z } from "zod";
import { expect } from "./assert";
import { PHONE_BUILD } from "./cloud-account";
import type { CloudWorker } from "./cloud-worker";

// a signed-in caller by the door it reaches `/v1` through: the phone its cookie under its app
// scheme, the browser extension the browser's signed session cookie as a bearer
export type V1Caller =
  | { readonly door: "phone"; readonly cookie: string }
  | { readonly door: "extension"; readonly bearer: string };

// the headers an app at this checkout's build sends, through its caller's door when it has one
const callerHeaders = (caller: V1Caller | null): Headers => {
  const headers = new Headers(clientBuildHeaders(PHONE_BUILD));
  if (caller?.door === "phone") {
    headers.set("cookie", caller.cookie);
    headers.set("expo-origin", PHONE_ORIGIN);
  }
  if (caller?.door === "extension") {
    headers.set("authorization", `Bearer ${caller.bearer}`);
  }
  return headers;
};

// the phone signed in on `cookie`, as `v1Client` and the file calls take it
export const asPhone = (cookie: string): V1Caller => ({ cookie, door: "phone" });

// what the browser extension sends for a browser holding `cookie`, a sign-up's or a sign-in's: the
// session cookie's own signed value
export const sessionBearerOf = (cookie: string): string => {
  const bearer = cookie
    .split("; ")
    .find((pair) => pair.split("=")[0]?.endsWith("better-auth.session_token") === true)
    ?.split("=")
    .slice(1)
    .join("=");
  expect(bearer !== undefined && bearer !== "", `no session cookie in ${cookie}`);
  return bearer;
};

// that browser's session through the extension's door, so an oracle calls as the extension does
export const asExtension = (cookie: string): V1Caller => ({
  bearer: sessionBearerOf(cookie),
  door: "extension",
});

export const v1Client = (worker: CloudWorker, caller: V1Caller | null): V1Client =>
  createORPCClient<V1Client>(
    new RPCLink({ headers: callerHeaders(caller), origin: worker.origin, url: V1_RPC_PATH }),
  );

// a file's bytes uploaded at the sha they hash to, as the apps upload one; its sha
export const uploadFile = async (
  worker: CloudWorker,
  caller: V1Caller,
  file: { readonly bytes: Uint8Array<ArrayBuffer>; readonly type: string },
): Promise<{ readonly sha: string; readonly status: number }> => {
  const sha = createHash("sha256").update(file.bytes).digest("hex");
  const headers = callerHeaders(caller);
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
  caller: V1Caller,
  sha: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> => {
  const asked = callerHeaders(caller);
  for (const [name, value] of Object.entries(headers)) {
    asked.set(name, value);
  }
  return await fetch(`${worker.origin}${V1_BLOBS_PATH}/${sha}`, { headers: asked });
};

// an item's every field as the cell holds it, read the way an app opens it, or null for an item it
// holds no live row of
export const itemFieldsOf = async (
  library: V1Client["library"],
  id: string,
): Promise<LibraryItemFields | null> => {
  const [error, item] = await safe(library.items.get({ id }));
  if (isDefinedError(error) && error.code === "NOT_FOUND") {
    return null;
  }
  if (error !== null) {
    throw error;
  }
  return item.fields;
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
