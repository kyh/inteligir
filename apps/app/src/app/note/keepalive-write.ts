// The pagehide last-gasp save: a keepalive fetch straight at the write route,
// because the page may be gone before an ordinary request completes.
// Deliberately UNGUARDED (no expectedHash): a CAS refusal here would have no
// one left to merge and retry, so the buffer — the user's latest — wins.
// fetch keepalive over sendBeacon: beacons are POST-only and this route is a
// PUT; keepalive carries any method with the same survive-unload contract.

import { API_BASE_PATH, apiRoutes } from "@repo/server-contract/routes";
import type { VaultWriteRequest } from "@repo/server-contract/vault";

export function sendKeepaliveWrite(
  origin: string,
  path: string,
  content: string,
  fetchImpl: typeof fetch = fetch,
): void {
  const body: VaultWriteRequest = { path, content };
  void fetchImpl(`${origin}${API_BASE_PATH}${apiRoutes.vault.write.path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // The page is unloading; there is nobody to tell.
  });
}
