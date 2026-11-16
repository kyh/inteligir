// `/v1` as every client calls it, and what a call that did not land met, in a client's terms: a
// refusal of the sign-in itself (the credential, the account, this build), a budget to wait out, or
// no answer at all, beside each procedure's own refusals, which its caller reads. A file's upload
// goes outside the link and is refused in the same errors.

import {
  createORPCClient,
  createORPCErrorFromJson,
  isORPCErrorJson,
  onError,
  RPCSerializer,
} from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { V1_RPC_PATH } from "../v1-contract";
import type { V1Client } from "../v1-contract";
import { isOrpcError } from "../v1-errors";
import { V1_BLOBS_PATH } from "./library-blobs";

// `/v1` as the host reaches it: the cloud's origin and a fetch that adds the session through the
// host's door and its build, or in the browser nothing past the session's own cookie
export interface V1Transport {
  readonly origin: string;
  readonly fetch: (request: Request) => Promise<Response>;
}

// the sign-in is over until the host signs in again (`signed-out`, `gone`) or updates (`outdated`)
export type SessionEnd = "signed-out" | "gone" | "outdated";

export type CallFailure =
  | { readonly kind: "session"; readonly end: SessionEnd }
  | { readonly kind: "busy" }
  | { readonly kind: "unreachable"; readonly message: string }
  // the cell refused the call's input: the row can never land as it is
  | { readonly kind: "malformed"; readonly message: string };

export const UNREACHABLE = "Your library can't be reached right now.";
export const CHANGE_REFUSED = "Your library couldn't take this change.";

const SESSION_ENDS: ReadonlyMap<string, SessionEnd> = new Map([
  ["UNAUTHORIZED", "signed-out"],
  ["GONE", "gone"],
  ["CLIENT_OUTDATED", "outdated"],
]);

// the failures every call shares; null for a refusal the procedure declares as its own
export const sharedFailure = (error: Error): CallFailure | null => {
  if (!isOrpcError(error)) {
    return { kind: "unreachable", message: UNREACHABLE };
  }
  if (error.defined) {
    const end = SESSION_ENDS.get(error.code);
    if (end !== undefined) {
      return { end, kind: "session" };
    }
    return error.code === "TOO_MANY_REQUESTS" ? { kind: "busy" } : null;
  }
  return error.code === "BAD_REQUEST"
    ? { kind: "malformed", message: CHANGE_REFUSED }
    : { kind: "unreachable", message: UNREACHABLE };
};

// how a call's failure ended the sign-in, if it did
export const sessionEndOf = (cause: unknown): SessionEnd | null => {
  const failure = cause instanceof Error ? sharedFailure(cause) : null;
  return failure?.kind === "session" ? failure.end : null;
};

// the cell's calls over the transport; the link hears every call's failure once, before its
// caller does, so a sign-in the cloud ended is answered whichever call met it
export const v1Client = (
  transport: V1Transport,
  onSessionEnd?: (end: SessionEnd) => void,
): V1Client =>
  createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => await transport.fetch(new Request(url, init)),
      interceptors: [
        onError((cause: unknown) => {
          const end = sessionEndOf(cause);
          if (end !== null) {
            onSessionEnd?.(end);
          }
        }),
      ],
      origin: transport.origin,
      url: V1_RPC_PATH,
    }),
  );

const serializer = new RPCSerializer();

// what an answer outside the link refused with, read as the link reads one: the error the wire
// declares, or for any other answer (a fault, a proxy's page) an error that names no refusal
const refusalIn = async (response: Response): Promise<Error> => {
  try {
    const body: unknown = await response.json();
    const refusal = serializer.deserialize(body);
    if (isORPCErrorJson(refusal)) {
      return createORPCErrorFromJson(refusal);
    }
  } catch {
    // no body the protocol wrote
  }
  return new Error(`the cloud answered ${String(response.status)}`);
};

// a file's bytes to `/v1/blobs/<sha>`, which keeps nothing that hashes otherwise. It lands or
// throws as a call does, so `sharedFailure` and `refusalText` read its failure, and the hook hears
// a sign-in it ended as the link's does
export const uploadBlob = async (
  transport: V1Transport,
  file: { readonly sha: string; readonly mime: string; readonly bytes: Uint8Array<ArrayBuffer> },
  onSessionEnd?: (end: SessionEnd) => void,
): Promise<void> => {
  const response = await transport.fetch(
    new Request(`${transport.origin}${V1_BLOBS_PATH}/${file.sha}`, {
      body: file.bytes,
      headers: { "content-type": file.mime },
      method: "PUT",
    }),
  );
  if (response.ok) {
    await response.arrayBuffer();
    return;
  }
  const refusal = await refusalIn(response);
  const end = sessionEndOf(refusal);
  if (end !== null) {
    onSessionEnd?.(end);
  }
  throw refusal;
};
