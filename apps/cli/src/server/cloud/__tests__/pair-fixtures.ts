import { PAIR_CALLBACK_PATH } from "@repo/api/cloud/pairing/pairing-schema";
import type { FakeCloud } from "./fake-cloud";

// the port is arbitrary — begin composes the callback from the request's own host.
export const LOOPBACK_HOST = "127.0.0.1:4664";

export const CALLBACK_URL = `http://${LOOPBACK_HOST}${PAIR_CALLBACK_PATH}`;

export const PAIR_CODE = "ABCD-EFGH";

export function approveMint(cloud: FakeCloud, approveUrl: string, code: string): void {
  cloud.mintCode(code, new URL(approveUrl).searchParams.get("challenge") ?? "");
}

export function stateOf(approveUrl: string): string {
  return new URL(approveUrl).searchParams.get("state") ?? "";
}

export function callbackFor(approveUrl: string, code: string, state: string): string {
  const callback = new URL(new URL(approveUrl).searchParams.get("redirect") ?? "");
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  return callback.toString();
}
