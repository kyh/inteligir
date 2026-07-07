// ---------------------------------------------------------------------------
// The vault id this install claims on the coordinator. Minted once (a v4 UUID)
// the first time sync runs and persisted in the secure store, so this device
// always syncs the SAME remote vault. First-writer-wins ownership on the
// coordinator then ties that vault id to the signed-in user.
// ---------------------------------------------------------------------------

import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const VAULT_ID_KEY = "inteligir.vaultId";

/** The stable per-install vault id, minting + persisting one on first call. */
export function getOrCreateVaultId(): string {
  const existing = SecureStore.getItem(VAULT_ID_KEY);
  if (existing !== null && existing !== "") return existing;
  const id = Crypto.randomUUID();
  SecureStore.setItem(VAULT_ID_KEY, id);
  return id;
}
