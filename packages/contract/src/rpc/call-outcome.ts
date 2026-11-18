import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { refusalText } from "./refusal-text";
import { V1_RPC_PATH } from "./v1-contract";
import type { V1Client } from "./v1-contract";
import { isOrpcError } from "./v1-errors";

export interface V1Transport {
  readonly origin: string;
  readonly fetch: (request: Request) => Promise<Response>;
}

export type SessionEnd = "signed-out" | "gone" | "outdated";

type CallFailure =
  | { readonly kind: "session"; readonly end: SessionEnd }
  | { readonly kind: "busy" }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "malformed"; readonly message: string };

export const UNREACHABLE = "Your library can't be reached right now.";
const CHANGE_REFUSED = "Your library couldn't take this change.";

const SESSION_ENDS: ReadonlyMap<string, SessionEnd> = new Map([
  ["UNAUTHORIZED", "signed-out"],
  ["GONE", "gone"],
  ["CLIENT_OUTDATED", "outdated"],
]);

export const sharedFailure = (error: Error) => {
  if (!isOrpcError(error)) {
    return { kind: "unreachable", message: UNREACHABLE } satisfies CallFailure | null;
  }

  if (error.defined) {
    const end = SESSION_ENDS.get(error.code);

    if (end !== undefined) {
      return { end, kind: "session" } satisfies CallFailure | null;
    }

    return (
      error.code === "TOO_MANY_REQUESTS" ? { kind: "busy" } : null
    ) satisfies CallFailure | null;
  }

  return (
    error.code === "BAD_REQUEST"
      ? { kind: "malformed", message: CHANGE_REFUSED }
      : { kind: "unreachable", message: UNREACHABLE }
  ) satisfies CallFailure | null;
};

export const sessionEndOf = (cause: unknown) => {
  const failure = cause instanceof Error ? sharedFailure(cause) : null;

  return failure?.kind === "session" ? failure.end : null;
};

export const v1Client = (transport: V1Transport, onSessionEnd?: (end: SessionEnd) => void) =>
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

interface UploadTarget {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

const putBytes = async (
  transport: V1Transport,
  target: UploadTarget,
  bytes: Uint8Array<ArrayBuffer>,
) => {
  const url = new URL(target.url, transport.origin);
  const init = { body: bytes, headers: { ...target.headers }, method: "PUT" };

  return url.origin === new URL(transport.origin).origin
    ? await transport.fetch(new Request(url, init))
    : await fetch(url, { ...init, credentials: "omit" });
};

export const uploadBlob = async (
  transport: V1Transport,
  file: { readonly sha: string; readonly mime: string; readonly bytes: Uint8Array<ArrayBuffer> },
  onSessionEnd?: (end: SessionEnd) => void,
) => {
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

export const WAITS = ["connection", "sign-in", "update"] as const;

export type WaitsFor = (typeof WAITS)[number];

export type CallOutcome<T> =
  | { readonly kind: "landed"; readonly answer: T }
  | { readonly kind: "wait"; readonly for: WaitsFor }
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  | { readonly kind: "gone" };

type Missed = Exclude<CallOutcome<never>, { readonly kind: "landed" }>;

const UNANSWERED: Missed = { for: "connection", kind: "wait" };

const SESSION_MISSES = {
  gone: { kind: "gone" },
  outdated: { for: "update", kind: "wait" },
  "signed-out": { for: "sign-in", kind: "wait" },
} as const satisfies Record<SessionEnd, Missed>;

const missedFor = (failure: CallFailure) => {
  switch (failure.kind) {
    case "session": {
      return SESSION_MISSES[failure.end];
    }

    case "busy":
    case "unreachable": {
      return UNANSWERED;
    }

    case "malformed": {
      return { code: "BAD_REQUEST", kind: "refused", message: failure.message } satisfies Missed;
    }

    default: {
      throw new Error(`unexpected ${String(failure satisfies never)}`);
    }
  }
};

const missedBy = (cause: unknown) => {
  if (!isOrpcError(cause)) {
    return UNANSWERED;
  }

  const failure = sharedFailure(cause);

  return (
    failure === null
      ? { code: cause.code, kind: "refused", message: refusalText(cause, CHANGE_REFUSED) }
      : missedFor(failure)
  ) satisfies Missed;
};

export const outcomeOf = async <T>(call: () => Promise<T>) => {
  try {
    return { answer: await call(), kind: "landed" } satisfies CallOutcome<T>;
  } catch (error) {
    return missedBy(error);
  }
};
