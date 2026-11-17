// The extension's calls to its cloud, `/v1` as every app calls it: `/v1/rpc` through oRPC's link
// and a file's bytes by their sha, each with the browser's session cookie as its bearer
// (./sign-in) and this build in a header, so the floor holds the extension as it holds every
// client. Every call has a deadline under the 30 s a service worker waits on a fetch, so a cloud
// that never answers leaves a save queued rather than a popup waiting.

import { bytesToHex } from "@noble/hashes/utils.js";
import { clientBuildHeaders } from "@repo/contract/client-build";
import { outcomeOf, uploadBlob, v1Client } from "@repo/contract/rpc/call-outcome";
import type { CallOutcome, V1Transport } from "@repo/contract/rpc/call-outcome";
import type { V1Client } from "@repo/contract/rpc/v1-contract";

import type { Session } from "./sign-in";

type Items = V1Client["library"]["items"];
export type PageSave = Parameters<Items["save"]>[0];
export type LinkSave = Parameters<Items["saveLink"]>[0];
export type FileCreate = Parameters<Items["createFile"]>[0];
// what the extension reads of a save's answer: the name the item's card goes by, which a link
// nobody named yet takes from its address, and whether the save made it or the library already
// held the address
export interface Saved {
  readonly created: boolean;
  readonly item: { readonly card: { readonly title: string } };
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
  const { items } = v1Client(transport).library;
  return {
    createFile: async (input) => await items.createFile(input),
    save: async (input) => await items.save(input),
    saveLink: async (input) => await items.saveLink(input),
    transport,
  };
};

// a file's bytes up by their SHA-256, which the answer names once the cloud keeps them
export const sendFile = async (
  cloud: Cloud,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Promise<CallOutcome<string>> => {
  const sha = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  return await outcomeOf(async () => {
    await uploadBlob(cloud.transport, { bytes, mime, sha });
    return sha;
  });
};
