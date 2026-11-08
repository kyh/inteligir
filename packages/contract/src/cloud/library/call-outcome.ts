// What a `/v1` call that did not land met, in a client's terms: a refusal of the sign-in itself
// (the credential, the account, this build), a budget to wait out, or no answer at all, beside
// each procedure's own refusals, which its caller reads. A file's upload answers in statuses, the
// same refusals by number.

import { isOrpcError } from "../v1-errors";
import { V1_BLOBS_PATH } from "./library-blobs";

// `/v1` as the host reaches it: the cloud's origin and a fetch that adds the device's credential
// and build, or in the browser the session's cookie
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

export type UploadOutcome =
  | { readonly kind: "stored" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly failure: CallFailure };

const UPLOAD_REFUSALS: ReadonlyMap<number, string> = new Map([
  [400, "This file changed on this device before it was sent."],
  [413, "This file is larger than your library keeps."],
  [507, "Your library is full."],
]);

const UPLOAD_FAILURES: ReadonlyMap<number, CallFailure> = new Map([
  [401, { end: "signed-out", kind: "session" }],
  [410, { end: "gone", kind: "session" }],
  [426, { end: "outdated", kind: "session" }],
  [429, { kind: "busy" }],
]);

// a file's bytes to `/v1/blobs/<sha>`, which keeps nothing that hashes otherwise
export const uploadBlob = async (
  transport: V1Transport,
  file: { readonly sha: string; readonly mime: string; readonly bytes: Uint8Array<ArrayBuffer> },
): Promise<UploadOutcome> => {
  let response: Response;
  try {
    response = await transport.fetch(
      new Request(`${transport.origin}${V1_BLOBS_PATH}/${file.sha}`, {
        body: file.bytes,
        headers: { "content-type": file.mime },
        method: "PUT",
      }),
    );
    await response.arrayBuffer();
  } catch {
    return { failure: { kind: "unreachable", message: UNREACHABLE }, kind: "failed" };
  }
  if (response.status === 201 || response.status === 204) {
    return { kind: "stored" };
  }
  const reason = UPLOAD_REFUSALS.get(response.status);
  if (reason !== undefined) {
    return { kind: "refused", reason };
  }
  return {
    failure: UPLOAD_FAILURES.get(response.status) ?? { kind: "unreachable", message: UNREACHABLE },
    kind: "failed",
  };
};
