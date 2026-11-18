// `/v1` as every client calls it, and what a call that did not land met, in a client's terms: a
// refusal of the sign-in itself (the credential, the account, this build), a budget to wait out, or
// no answer at all, beside each procedure's own refusals, which its caller reads. A file's bytes
// go to the store between two calls, and a store that refused them reads as no answer. What a call
// made of the save it carried is one reading for every host that keeps a save (`CallOutcome`).

import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { refusalText } from "./refusal-text";
import { V1_RPC_PATH } from "./v1-contract";
import type { V1Client } from "./v1-contract";
import { isOrpcError } from "./v1-errors";

// `/v1` as the host reaches it: the cloud's origin and a fetch that adds the session through the
// host's door and its build, or in the browser nothing past the session's own cookie
export interface V1Transport {
  readonly origin: string;
  readonly fetch: (request: Request) => Promise<Response>;
}

// the sign-in is over until the host signs in again (`signed-out`, `gone`) or updates (`outdated`)
export type SessionEnd = "signed-out" | "gone" | "outdated";

type CallFailure =
  | { readonly kind: "session"; readonly end: SessionEnd }
  | { readonly kind: "busy" }
  | { readonly kind: "unreachable"; readonly message: string }
  // the cell refused the call's input: the row can never land as it is
  | { readonly kind: "malformed"; readonly message: string };

export const UNREACHABLE = "Your library can't be reached right now.";
const CHANGE_REFUSED = "Your library couldn't take this change.";

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

// where `library.files.reserve` sends a file's bytes
interface UploadTarget {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

// A store on the cloud's own origin is reached as `/v1` is; any other is sent nothing of the
// host's session, which is the cloud's alone
const putBytes = async (
  transport: V1Transport,
  target: UploadTarget,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Response> => {
  const url = new URL(target.url, transport.origin);
  const init = { body: bytes, headers: { ...target.headers }, method: "PUT" };
  return url.origin === new URL(transport.origin).origin
    ? await transport.fetch(new Request(url, init))
    : await fetch(url, { ...init, credentials: "omit" });
};

// A file's bytes, kept in the library under the sha they hash to: reserved, sent to the store the
// cloud names and settled, or not sent at all when the library holds them already. It lands or
// throws as a call does, so `sharedFailure` and `refusalText` read its failure, and the hook hears
// a sign-in it ended. A store that refused the bytes (an address past its time, a size or a type
// it was not told) reads as no answer, since the next try reserves afresh
export const uploadBlob = async (
  transport: V1Transport,
  file: { readonly sha: string; readonly mime: string; readonly bytes: Uint8Array<ArrayBuffer> },
  onSessionEnd?: (end: SessionEnd) => void,
): Promise<void> => {
  const { files } = v1Client(transport, onSessionEnd).library;
  const { bytes, mime, sha } = file;
  const reserved = await files.reserve({ bytes: bytes.byteLength, mime, sha });
  if (reserved.kind === "held") {
    return;
  }
  const stored = await putBytes(transport, reserved, bytes);
  await stored.arrayBuffer();
  if (!stored.ok) {
    throw new Error(`the store answered ${String(stored.status)}`);
  }
  await files.settle({ sha, uploadId: reserved.uploadId });
};

// what brings a later try of the same call through: the cloud's answer, the host's next sign-in,
// or its update
export const WAITS = ["connection", "sign-in", "update"] as const;
export type WaitsFor = (typeof WAITS)[number];

// What a call made of the save it carried, read one way by every host that keeps a save: it
// landed, a later try may land it, no resend lands it as it is, or its account is deleted and
// nothing kept for it can land.
export type CallOutcome<T> =
  | { readonly kind: "landed"; readonly answer: T }
  | { readonly kind: "wait"; readonly for: WaitsFor }
  // the refusal's code, and its words for the person
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  | { readonly kind: "gone" };

type Missed = Exclude<CallOutcome<never>, { readonly kind: "landed" }>;

const UNANSWERED: Missed = { for: "connection", kind: "wait" };

const SESSION_MISSES = {
  gone: { kind: "gone" },
  outdated: { for: "update", kind: "wait" },
  "signed-out": { for: "sign-in", kind: "wait" },
} as const satisfies Record<SessionEnd, Missed>;

const missedFor = (failure: CallFailure): Missed => {
  switch (failure.kind) {
    case "session": {
      return SESSION_MISSES[failure.end];
    }
    // the cloud's budget for a minute, or no answer: a later try may pass
    case "busy":
    case "unreachable": {
      return UNANSWERED;
    }
    case "malformed": {
      return { code: "BAD_REQUEST", kind: "refused", message: failure.message };
    }
    // no default
  }
};

// a refusal the procedure declares as its own is said in its words
const missedBy = (cause: unknown): Missed => {
  if (!isOrpcError(cause)) {
    return UNANSWERED;
  }
  const failure = sharedFailure(cause);
  return failure === null
    ? { code: cause.code, kind: "refused", message: refusalText(cause, CHANGE_REFUSED) }
    : missedFor(failure);
};

// a call's answer, or what the error it threw says it missed by; a file's upload is read the same
// way, since it throws as a call does
export const outcomeOf = async <T>(call: () => Promise<T>): Promise<CallOutcome<T>> => {
  try {
    return { answer: await call(), kind: "landed" };
  } catch (error) {
    return missedBy(error);
  }
};
