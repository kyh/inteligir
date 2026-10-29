// What an account does for these notes depends on where they already sync, so every surface that
// offers one says it from the vault's status: the first run's step, Settings › Account and the
// rail's dialog. A vault another service syncs, or one with a server of its own, never starts
// syncing through the account, and threads stay on the Mac they ran on, so for it an account does
// nothing: the first run skips its step, and the other two say so plainly.

import { externalSyncName } from "@repo/contract/local/vault/vault-schema";
import type { VaultStatusResponse } from "@repo/contract/local/vault/vault-schema";

type AccountOffer = { kind: "offer"; title: string; lead: string } | { kind: "none"; lead: string };

export const accountOffer = (vault: VaultStatusResponse): AccountOffer => {
  if (vault.state === "no-remote" && vault.externalSync !== null) {
    return {
      kind: "none",
      lead: `${externalSyncName(vault.externalSync)} already syncs this library, so an account does nothing for it: the library stays there, and your iPhone can't show it.`,
    };
  }
  if (vault.state !== "no-remote" && vault.remoteSource !== "account") {
    return {
      kind: "none",
      lead: "This library syncs with a server of its own, so an account does nothing for it unless you switch it to your account in Settings › Advanced.",
    };
  }
  return {
    kind: "offer",
    lead: "An account backs up your library and brings it to your other Macs and your iPhone.",
    title: "Back up your library",
  };
};
