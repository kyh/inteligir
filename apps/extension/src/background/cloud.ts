// The extension's calls to its cloud, `/v1` as every app calls it: `/v1/rpc` through oRPC's link
// and a file's bytes by their sha, each with the browser's session cookie as its bearer
// (./sign-in) and this build in a header, so the floor holds the extension as it holds every
// client. Every call has a deadline under the 30 s a service worker waits on a fetch, so a cloud
// that never answers leaves a save queued rather than a popup waiting.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { hexFromBytes } from "@repo/contract/bytes";
import { clientBuildHeaders } from "@repo/contract/client-build";
import { sharedFailure, UNREACHABLE, uploadBlob } from "@repo/contract/library/call-outcome";
import type { CallFailure, V1Transport } from "@repo/contract/library/call-outcome";
import { isOrpcError } from "@repo/contract/v1/errors";
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

// what a save asks of the cloud: the library's two saves and a file's create, and `/v1` for the
// bytes
export interface Cloud {
  readonly save: (input: PageSave) => Promise<Saved>;
  readonly saveLink: (input: LinkSave) => Promise<Saved>;
  readonly createFile: (input: FileCreate) => Promise<Pick<Saved, "item">>;
  readonly transport: V1Transport;
}

export const CALL_DEADLINE_MS = 25_000;

export const cloudOf = (session: Session, version: string): Cloud => {
  const headers = {
    ...clientBuildHeaders({ platform: "extension", version }),
    authorization: `Bearer ${session.bearer}`,
  };
  const transport: V1Transport = {
    fetch: async (request) => {
      const signed = new Headers(request.headers);
      for (const [name, value] of Object.entries(headers)) {
        signed.set(name, value);
      }
      return await fetch(
        new Request(request, { headers: signed, signal: AbortSignal.timeout(CALL_DEADLINE_MS) }),
      );
    },
    origin: session.origin,
  };
  const { items } = createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => await transport.fetch(new Request(url, init)),
      origin: transport.origin,
      url: V1_RPC_PATH,
    }),
  ).library;
  return {
    createFile: async (input) => await items.createFile(input),
    save: async (input) => await items.save(input),
    saveLink: async (input) => await items.saveLink(input),
    transport,
  };
};

// what a call that did not land missed by: a failure every call shares, or a refusal the
// procedure declares as its own, by its code
export type Miss = CallFailure | { readonly kind: "refused"; readonly code: string };

// how a call went: its answer, or what it missed by
export type Sent<T> = { readonly kind: "landed"; readonly answer: T } | Miss;

// a call's answer, or what the error it threw says it missed by
export const sent = async <T>(call: () => Promise<T>): Promise<Sent<T>> => {
  try {
    return { answer: await call(), kind: "landed" };
  } catch (error) {
    const shared = error instanceof Error ? sharedFailure(error) : null;
    if (shared !== null) {
      return shared;
    }
    return isOrpcError(error)
      ? { code: error.code, kind: "refused" }
      : { kind: "unreachable", message: UNREACHABLE };
  }
};

// a file's bytes up by their SHA-256, which the answer names once the cloud keeps them
export const sendFile = async (
  cloud: Cloud,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Promise<Sent<string>> => {
  const sha = hexFromBytes(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  const outcome = await uploadBlob(cloud.transport, { bytes, mime, sha });
  switch (outcome.kind) {
    case "stored": {
      return { answer: sha, kind: "landed" };
    }
    case "refused": {
      return { code: outcome.code, kind: "refused" };
    }
    case "failed": {
      return outcome.failure;
    }
    // no default
  }
};
