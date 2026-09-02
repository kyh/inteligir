// The pairing fixtures every cloud suite shares: the loopback address an
// install pretends to be reached on, the code the approve page mints, and the
// approve page's own acts over `FakeCloud`.

import { PAIR_CALLBACK_PATH } from "@repo/api/cloud/pairing/pairing-schema";
import type { FakeCloud } from "./fake-cloud";

/** The loopback address these installs pretend to be reached on. The begin
 *  procedure composes the callback from the request's own Host, because
 *  `listen` may have probed past the configured port — so the port here is
 *  arbitrary; what matters is a shape `pairRedirectUrlSchema` admits. */
export const LOOPBACK_HOST = "127.0.0.1:4664";

/** Where this app would send the browser back to. */
export const CALLBACK_URL = `http://${LOOPBACK_HOST}${PAIR_CALLBACK_PATH}`;

export const PAIR_CODE = "ABCD-EFGH";

/** The approve page's mint: the code BOUND to the PKCE challenge `beginPair`
 *  put on the URL. Only possible after begin, because the challenge exists
 *  only then — the app kept the verifier, the browser only ever saw the hash. */
export function approveMint(cloud: FakeCloud, approveUrl: string, code: string): void {
  cloud.mintCode(code, new URL(approveUrl).searchParams.get("challenge") ?? "");
}

/** The `state` the approve URL carries, which the callback must echo. */
export function stateOf(approveUrl: string): string {
  return new URL(approveUrl).searchParams.get("state") ?? "";
}

/** What the browser follows after approval: the redirect begin composed,
 *  carrying the code and the state. */
export function callbackFor(approveUrl: string, code: string, state: string): string {
  const callback = new URL(new URL(approveUrl).searchParams.get("redirect") ?? "");
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  return callback.toString();
}
