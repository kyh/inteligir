// What an account does for these notes depends on where they already sync, so every surface that
// offers one says it from the vault's status: the first run's step, Settings › Account and the
// rail's dialog. The account form's own sentence promises the notes start syncing, which a vault
// another service syncs, or one with a server of its own, never does.

import { externalSyncName } from "@repo/api/local/vault/vault-schema";
import type { VaultStatusResponse } from "@repo/api/local/vault/vault-schema";

interface AccountOffer {
  title: string;
  lead: string;
}

export const accountOffer = (vault: VaultStatusResponse): AccountOffer => {
  if (vault.state === "no-remote" && vault.externalSync !== null) {
    return {
      lead: `${externalSyncName(vault.externalSync)} already syncs these notes, and your phone won't show them. An account still carries your conversations with the agent to your other Macs.`,
      title: "Create your account",
    };
  }
  if (vault.state !== "no-remote" && vault.remoteSource === "explicit") {
    return {
      lead: "These notes keep syncing where they already do. An account carries your conversations with the agent to your other devices.",
      title: "Create your account",
    };
  }
  return {
    lead: "An account backs up your notes and brings them to your other Macs and your iPhone.",
    title: "Back up your notes",
  };
};
