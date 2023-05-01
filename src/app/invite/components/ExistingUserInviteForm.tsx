"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/auth-helpers-nextjs";

import Trans from "~/core/ui/Trans";
import Button from "~/core/ui/Button";

import useSignOut from "~/core/hooks/use-sign-out";
import useAcceptInvite from "~/app/invite/use-accept-invite";
import configuration from "~/configuration";

function ExistingUserInviteForm(
  props: React.PropsWithChildren<{
    session: Session;
  }>
) {
  const signOut = useSignOut();
  const acceptInvite = useAcceptInvite();
  const router = useRouter();

  const onInviteAccepted = useCallback(async () => {
    await acceptInvite.trigger({});

    return router.push(configuration.paths.appHome);
  }, [acceptInvite, router]);

  return (
    <>
      <div className="flex flex-col space-y-4">
        <p className="text-center text-sm">
          <Trans
            i18nKey="auth:clickToAcceptAs"
            values={{ email: props.session?.user.email }}
            components={{ b: <b /> }}
          />
        </p>

        <Button
          block
          onClick={onInviteAccepted}
          data-cy="accept-invite-submit-button"
          type="submit"
        >
          <Trans i18nKey="auth:acceptInvite" />
        </Button>

        <div>
          <div className="flex flex-col space-y-2">
            <p className="text-center">
              <span className="text-center text-sm text-gray-700 dark:text-gray-300">
                <Trans i18nKey="auth:acceptInviteWithDifferentAccount" />
              </span>
            </p>

            <Button
              block
              color="transparent"
              size="small"
              onClick={signOut}
              type="button"
            >
              <Trans i18nKey="auth:signOut" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export default ExistingUserInviteForm;
