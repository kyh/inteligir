// ---------------------------------------------------------------------------
// Redeem a desktop pairing blob into an enrollment. PURE — the store, the key
// generator, `fetch` and the clock are injected, so the whole flow runs under
// node in tests.
//
// The blob carries the three things this device cannot derive: which
// coordinator, which vault, and the offer secret that authorizes the join. The
// route is UNAUTHENTICATED by design — the secret IS the auth — so this is the
// one call here that presents no assertion.
//
// The coordinator answers a refusal identically for wrong, expired and
// already-consumed, deliberately: the route must not become an
// offer-existence oracle. This module keeps that promise on the client side by
// rendering ONE message for all three rather than guessing between them.
//
// Nothing is persisted until the server has accepted the key. The residual is
// worth naming: an enrollment that succeeds and then fails to persist leaves a
// roster row this phone cannot use — pair again, and remove the stale row from
// the desktop's device list.
// ---------------------------------------------------------------------------

import { isRecord } from "@repo/notes/sync/guards";
import type { FetchFn } from "@repo/notes/sync/http-sync-port";
import { enrollPath, parsePairingBlob, type EnrollRequest } from "@repo/notes/sync/wire";

import type { DeviceKeyPair } from "./device-key";
import type { DeviceStore, EnrolledDevice } from "./device-store";

export type EnrollResult =
  | { readonly ok: true; readonly device: EnrolledDevice }
  | { readonly ok: false; readonly error: string };

export type EnrollPorts = {
  readonly store: DeviceStore;
  readonly generateKey: () => DeviceKeyPair;
  readonly fetchImpl: FetchFn;
  readonly now: () => number;
};

const REFUSED =
  "The pairing code was refused. It may have expired or already been used — create a new one on the desktop.";

/** Parse a pasted blob, join the vault it names, and persist the enrollment. */
export async function enrollWithPairingBlob(
  ports: EnrollPorts,
  blobText: string,
  deviceName: string,
): Promise<EnrollResult> {
  const blob = parsePairingBlob(blobText);
  if (blob === null) {
    return {
      ok: false,
      error: "That isn't a pairing code. Copy the whole block from the desktop and paste it here.",
    };
  }

  const key = ports.generateKey();
  const body: EnrollRequest = { s: blob.s, publicKey: key.publicKey, deviceName };
  const url = `${blob.url.replace(/\/+$/, "")}${enrollPath(blob.vid)}`;

  let response: Response;
  try {
    response = await ports.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The server is unreachable.",
    };
  }
  if (!response.ok) {
    return { ok: false, error: `The server refused the request (HTTP ${response.status}).` };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { ok: false, error: "The server returned a malformed response." };
  }
  const accepted = isRecord(raw) ? raw["ok"] : undefined;
  if (typeof accepted !== "boolean") {
    return { ok: false, error: "The server returned a malformed response." };
  }
  if (!accepted) return { ok: false, error: REFUSED };

  const device: EnrolledDevice = {
    url: blob.url,
    vaultId: blob.vid,
    publicKey: key.publicKey,
    enrolledAt: ports.now(),
  };
  ports.store.save(device, key.secretKey);
  return { ok: true, device };
}
