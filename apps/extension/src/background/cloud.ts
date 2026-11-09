// The extension's calls to its cloud, `/v1` as every app calls it: `/v1/rpc` through oRPC's link
// and a file's bytes by their sha, each with the browser's session cookie as its bearer
// (./sign-in) and this build in a header, so the floor holds the extension as it holds every
// client. Every call has a deadline under the 30 s a service worker waits on a fetch, so a cloud
// that never answers leaves a save queued rather than a popup waiting.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { clientBuildHeaders } from "@repo/contract/client-build";
import { isOrpcError, V1_ERROR_STATUS_MAP } from "@repo/contract/v1/errors";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { V1_RPC_PATH } from "@repo/contract/v1";
import type { V1Client } from "@repo/contract/v1";

import type { Session } from "./sign-in";

type Items = V1Client["library"]["items"];
/** @internal */
export type PageSave = Parameters<Items["save"]>[0];
export type LinkSave = Parameters<Items["saveLink"]>[0];
/** @internal */
export type FileCreate = Parameters<Items["createFile"]>[0];
// what the extension reads of a save's answer: the item's name as it landed, and whether the save
// made it or the library already held the address
export interface Saved {
  readonly created: boolean;
  readonly item: { readonly fields: { readonly title: string } };
}

// what a save asks of the cloud: the library's two saves and a file's create, and the bytes
export interface Cloud {
  readonly save: (input: PageSave) => Promise<Saved>;
  readonly saveLink: (input: LinkSave) => Promise<Saved>;
  readonly createFile: (input: FileCreate) => Promise<Pick<Saved, "item">>;
  readonly putFile: (bytes: Uint8Array<ArrayBuffer>, mime: string) => Promise<string>;
}

export const CALL_DEADLINE_MS = 25_000;

// the build every request names: this extension's version, from its manifest
const buildHeaders = (version: string): Record<string, string> =>
  clientBuildHeaders({ platform: "extension", version });

const hexOf = (digest: ArrayBuffer): string =>
  Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");

// a PUT the cloud answered with something other than a stored file, as a refusal reads
/** @internal */
export class FileRefusedError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`the cloud answered ${String(status)} to a file`);
    this.name = "FileRefusedError";
    this.status = status;
  }
}

export const cloudOf = (session: Session, version: string): Cloud => {
  const headers = { ...buildHeaders(version), authorization: `Bearer ${session.bearer}` };
  const { items } = createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) =>
        await fetch(url, { ...init, signal: AbortSignal.timeout(CALL_DEADLINE_MS) }),
      headers,
      origin: session.origin,
      url: V1_RPC_PATH,
    }),
  ).library;
  return {
    createFile: async (input) => await items.createFile(input),
    putFile: async (bytes, mime) => {
      const sha = hexOf(await crypto.subtle.digest("SHA-256", bytes));
      const response = await fetch(`${session.origin}${V1_BLOBS_PATH}/${sha}`, {
        body: bytes,
        headers: { ...headers, "content-type": mime },
        method: "PUT",
        signal: AbortSignal.timeout(CALL_DEADLINE_MS),
      });
      await response.arrayBuffer();
      if (!response.ok) {
        throw new FileRefusedError(response.status);
      }
      return sha;
    },
    save: async (input) => await items.save(input),
    saveLink: async (input) => await items.saveLink(input),
  };
};

// what a failed call means for the save that made it
export type CallFailure =
  // the session ended, signed out on the site, from another device or by its age: what was saved
  // under it waits for that account to sign in again
  | { readonly kind: "signed-out" }
  // the account was deleted: nothing saved under it can land
  | { readonly kind: "gone" }
  // a refusal no resend passes, in the words it names
  | { readonly kind: "refused"; readonly reason: CallRefusal }
  // no answer, or one a later try may pass: the save waits to be sent again
  | { readonly kind: "unanswered" };

type CallRefusal = "update-extension" | "library-full" | "too-large" | "failed";

// the refusals a person can act on; any other the cloud answered under a 4xx no resend passes
const REFUSALS = new Map<string, CallRefusal>([
  ["CLIENT_OUTDATED", "update-extension"],
  ["PAYLOAD_TOO_LARGE", "too-large"],
  ["QUOTA", "library-full"],
]);

// the status each code is answered under; a code no row names is the cloud's own fault
const CODE_STATUS = new Map<string, number>(Object.entries(V1_ERROR_STATUS_MAP));
const FAULT_STATUS = 500;

// a file's statuses, as `/v1/blobs` answers them
const FILE_REFUSALS = new Map<number, CallFailure>([
  [401, { kind: "signed-out" }],
  [410, { kind: "gone" }],
  [413, { kind: "refused", reason: "too-large" }],
  [426, { kind: "refused", reason: "update-extension" }],
  [507, { kind: "refused", reason: "library-full" }],
]);

export const failureOf = (cause: unknown): CallFailure => {
  if (cause instanceof FileRefusedError) {
    return FILE_REFUSALS.get(cause.status) ?? { kind: "unanswered" };
  }
  // a fetch that threw (no connection, the deadline) never reached the cloud
  if (!isOrpcError(cause)) {
    return { kind: "unanswered" };
  }
  if (cause.code === "UNAUTHORIZED") {
    return { kind: "signed-out" };
  }
  if (cause.code === "GONE") {
    return { kind: "gone" };
  }
  const reason = REFUSALS.get(cause.code);
  if (reason !== undefined) {
    return { kind: "refused", reason };
  }
  // the cloud's own fault, or its budget for a minute: a later try may pass
  const status = CODE_STATUS.get(cause.code) ?? FAULT_STATUS;
  return status >= FAULT_STATUS || cause.code === "TOO_MANY_REQUESTS"
    ? { kind: "unanswered" }
    : { kind: "refused", reason: "failed" };
};
