// The first run's offer of an account, over the one AccountForm and `useCloudSession`, opening on
// Create: the cohort joins with an invite. A device signed in has nothing left to be offered,
// which is also how a sign-up or a sign-in moves the step on.

import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { useEffect, useEffectEvent } from "react";
import { AccountForm } from "../account-form";
import { accountOffer } from "../account-offer";
import { useCloudSession } from "../cloud-session";
import { useVaultStatus } from "../vault-hooks";

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
