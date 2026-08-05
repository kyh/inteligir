// ---------------------------------------------------------------------------
// Which vault this phone syncs, where, and how it proves itself — the one seam
// both the engine (./manager.ts) and the SSE stream (./realtime-manager.ts)
// read, so neither can drift onto a different vault than the other.
//
// The DEVICE key wins when one exists: enrolling is the deliberate act that
// moves this install onto the device model, and the account session is left in
// place underneath it so disconnecting restores exactly what was there before.
// ---------------------------------------------------------------------------

import { getBearerToken } from "../auth";
import { getCoordinatorUrl } from "../base-url";
import { getDevice, mintDeviceToken } from "./device";
import { getOrCreateVaultId } from "./vault-id";

/** What this device has no credential at all reads as, in the sync status. */
export const NO_CREDENTIAL_MESSAGE = "not paired or signed in";

export type SyncCredential = {
  /** Identity of the credential — a change here rebuilds the engine. Assertions
   * are minted per request and so cannot serve as one. */
  readonly id: string;
  readonly baseUrl: string;
  readonly vaultId: string;
  readonly getToken: () => Promise<string>;
};

/** The credential to sync with right now, or null when there is none. */
export function currentCredential(): SyncCredential | null {
  const device = getDevice();
  if (device !== null) {
    return {
      id: `device:${device.vaultId}`,
      baseUrl: device.url,
      vaultId: device.vaultId,
      // Minting can throw (an unreadable keychain); a rejected token lands in
      // the pass outcome as an error, exactly like a transport failure.
      getToken: () => Promise.resolve().then(() => mintDeviceToken(device)),
    };
  }
  const token = getBearerToken();
  if (token === null || token === "") return null;
  return {
    id: `account:${token}`,
    baseUrl: getCoordinatorUrl(),
    vaultId: getOrCreateVaultId(),
    getToken: () => Promise.resolve(token),
  };
}
