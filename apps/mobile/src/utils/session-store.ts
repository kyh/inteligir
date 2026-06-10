import * as SecureStore from "expo-secure-store";
import {
  formatPairingString,
  parsePairingString,
  type PairingCredential,
} from "@repo/dispatch/pairing";

/** The credential is stored as its formatted pairing string, so
 * `parsePairingString` doubles as validation on read — corrupt or legacy
 * values come back as null and force a re-pair instead of a broken connect. */
const PAIRING_KEY = "dispatch_pairing";

/** Pre-protocol-v1 key: a bare 6-char room code with no bearer token. It
 * cannot authenticate under v1 (and the old room no longer exists), so
 * migration is deletion — the user re-pairs with a fresh pairing string. */
const LEGACY_ROOM_CODE_KEY = "dispatch_room_code";

export function getCredential(): PairingCredential | null {
  if (SecureStore.getItem(LEGACY_ROOM_CODE_KEY) !== null) {
    SecureStore.deleteItemAsync(LEGACY_ROOM_CODE_KEY).catch(() => undefined);
  }
  const raw = SecureStore.getItem(PAIRING_KEY);
  return raw === null ? null : parsePairingString(raw);
}

export function setCredential(credential: PairingCredential): void {
  SecureStore.setItem(PAIRING_KEY, formatPairingString(credential));
}

export async function clearCredential(): Promise<void> {
  await SecureStore.deleteItemAsync(PAIRING_KEY);
}
