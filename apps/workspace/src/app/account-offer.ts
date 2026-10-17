// What an account does for these notes depends on where they already sync, so every surface that
// offers one says it from the vault's status: the first run's step, Settings › Account and the
// rail's dialog. A vault another service syncs, or one with a server of its own, never starts
// syncing through the account.

import { externalSyncName } from "@repo/contract/local/vault/vault-schema";
import type { VaultStatusResponse } from "@repo/contract/local/vault/vault-schema";

interface AccountOffer {
  title: string;
  lead: string;
}

export const accountOffer = (vault: VaultStatusResponse): AccountOffer => {
  if (vault.state === "no-remote" && vault.externalSync !== null) {
    return {
      lead: `${externalSyncName(vault.externalSync)} already syncs this library, and your phone won't show it. An account still carries your conversations with the agent to your other Macs.`,
      title: "Create your account",
    };
  }
  if (vault.state !== "no-remote" && vault.remoteSource !== "account") {
    return {
      lead: "This library keeps syncing where it already does. An account carries your conversations with the agent to your other devices.",
      title: "Create your account",
    };
  }
  return {
    lead: "An account backs up your library and brings it to your other Macs and your iPhone.",
    title: "Back up your library",
  };
};
