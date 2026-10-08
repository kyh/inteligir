// The offer of an account, over the one AccountForm and `useCloudSession`, opening on Create: the
// cohort joins with an invite. A device signed in has nothing left to be offered, which is also
// how a sign-up or a sign-in moves the step on.

import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { useEffect, useEffectEvent } from "react";
import { AccountForm } from "../account-form";
import { useCloudSession } from "../cloud-session";

export const AccountStep = ({ onNext }: { onNext: () => void }) => {
  const session = useCloudSession();
  const cloud = session.status;
  const settled = cloud !== undefined && cloud.state !== "signed-out";
  const moveOn = useEffectEvent(onNext);
  useEffect(() => {
    if (settled) {
      moveOn();
    }
  }, [settled]);

  const skip = (
    <Button variant="ghost" size="compact" className="-ml-2 self-start" onClick={onNext}>
      Skip for now
    </Button>
  );
  // skipping needs nothing from the status, so a slow one never holds the step
  if (cloud?.state !== "signed-out") {
    return (
      <>
        <Spinner className="text-muted-foreground" />
        {skip}
      </>
    );
  }
  return (
    <>
      <h1 className="text-title font-medium">Create your account</h1>
      <AccountForm cloudUrl={cloud.cloudUrl} initialMode="create" session={session} />
      {skip}
    </>
  );
};
