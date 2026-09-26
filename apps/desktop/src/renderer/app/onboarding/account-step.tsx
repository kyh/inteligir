// The first run's offer of an account, over the one AccountForm and `useCloudSession`, opening on
// Create: the cohort joins with an invite. What an account does for these notes depends on where
// they already sync, so the offer follows the vault's status. A device signed in has nothing left
// to be offered, which is also how a sign-up or a sign-in moves the step on.

import { externalSyncName } from "@repo/api/local/vault/vault-schema";
import type { VaultStatusResponse } from "@repo/api/local/vault/vault-schema";
import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { useEffect, useEffectEvent } from "react";
import { AccountForm } from "../account-form";
import { useCloudSession } from "../cloud-session";
import { useVaultStatus } from "../vault-hooks";

interface AccountOffer {
  title: string;
  lead: string;
}

const accountOffer = (vault: VaultStatusResponse): AccountOffer => {
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

export const AccountStep = ({ onNext }: { onNext: () => void }) => {
  const session = useCloudSession();
  const vault = useVaultStatus().data;
  const cloud = session.status;
  const settled = cloud !== undefined && cloud.state !== "signed-out";
  const moveOn = useEffectEvent(onNext);
  useEffect(() => {
    if (settled) {
      moveOn();
    }
  }, [settled]);

  if (cloud?.state !== "signed-out" || vault === undefined) {
    return <Spinner className="text-muted-foreground" />;
  }
  const offer = accountOffer(vault);
  const handleCreate = session.signUp;
  const handleSignIn = session.signIn;
  return (
    <>
      <h1 className="text-title font-medium">{offer.title}</h1>
      <AccountForm
        cloudUrl={cloud.cloudUrl}
        initialMode="create"
        lead={offer.lead}
        onCreate={handleCreate}
        onSignIn={handleSignIn}
        pending={session.pending}
        refusal={session.refusal}
      />
      <Button variant="ghost" size="compact" className="-ml-2 self-start" onClick={onNext}>
        Skip for now
      </Button>
    </>
  );
};
