"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/auth-helpers-nextjs";
import useRefresh from "~/core/hooks/use-refresh";
import useSignOut from "~/core/hooks/use-sign-out";
import { Button } from "~/components/Button";
import useAcceptInvite from "~/app/invite/use-accept-invite";

const ExistingUserInviteForm = (
  props: React.PropsWithChildren<{
    session: Session;
  }>
) => {
  const signOut = useSignOut();
  const acceptInvite = useAcceptInvite();
  const router = useRouter();
  const refresh = useRefresh();

  const onSignOut = useCallback(async () => {
    await signOut();
    await refresh();
  }, [refresh, signOut]);

  const onInviteAccepted = useCallback(async () => {
    await acceptInvite.trigger({});

    return router.push("/dashboard");
  }, [acceptInvite, router]);

  return (
    <>
      <div className="flex flex-col space-y-4">
        <p className="text-center text-sm">
          Click the button below to accept the invite with as{" "}
          <b>{props.session.user.email}</b>
        </p>

        <Button
          onClick={onInviteAccepted}
          data-cy="accept-invite-submit-button"
          type="submit"
        >
          Accept invite
        </Button>

        <div>
          <div className="flex flex-col space-y-2">
            <p className="text-center">
              <span className="text-center text-sm text-zinc-700 dark:text-zinc-300">
                Want to accept the invite with a different account?
              </span>
            </p>
            <Button onClick={onSignOut} type="button">
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ExistingUserInviteForm;
