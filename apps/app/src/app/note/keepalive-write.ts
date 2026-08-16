// The pagehide last-gasp save: the typed write route with a keepalive
// RequestInit, because the page may be gone before an ordinary request
// completes. Deliberately UNGUARDED (no expectedHash): a CAS refusal here
// would have no one left to merge and retry, so the buffer — the user's
// latest — wins. fetch keepalive over sendBeacon: beacons are POST-only and
// this route is a PUT; keepalive carries any method with the same
// survive-unload contract.

import { createApiClient } from "@repo/server-contract/client";
import type { VaultWriteRequest } from "@repo/server-contract/vault";

export function sendKeepaliveWrite(
  origin: string,
  path: string,
  content: string,
  fetchImpl: typeof fetch = fetch,
): void {
  const api = createApiClient(origin, { fetch: fetchImpl });
  const json: VaultWriteRequest = { path, content };
  void api.vault.file.$put({ json }, { init: { keepalive: true } }).catch(() => {
    // The page is unloading; there is nobody to tell.
  });
}
