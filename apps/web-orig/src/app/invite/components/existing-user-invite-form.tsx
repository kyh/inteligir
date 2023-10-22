"use client";

import { useCallback, useTransition } from "react";
import type { Session } from "@supabase/auth-helpers-nextjs";
import { useRouter } from "next/navigation";
import useSignOut from "@/features/auth/use-sign-out";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import { acceptInviteAction } from "@/features/memberships/actions";
import Button from "ui/components/button";
import Trans from "ui/components/trans";

const ExistingUserInviteForm = (
  props: React.PropsWithChildren<{
    session: Session;
    code: string;
  }>,
) => {
  const signOut = useSignOut();
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
  const csrfToken = useCsrfToken();

  const onSignOut = useCallback(async () => {
    await signOut();
    router.refresh();
  }, [router, signOut]);

  const onInviteAccepted = useCallback(async () => {
    startTransition(async () => {
      await acceptInviteAction({
        csrfToken,
        code: props.code,
      });
    });
  }, [props.code, csrfToken, startTransition]);

  return (
    <div className="flex flex-col space-y-4">
      <p className="text-center text-sm">
        <Trans
          components={{ b: <b /> }}
          i18nKey="auth:clickToAcceptAs"
          values={{ email: props.session.user.email }}
        />
      </p>

      <Button
        block
        data-cy="accept-invite-submit-button"
        loading={isSubmitting}
        onClick={onInviteAccepted}
        type="submit"
      >
        <Trans i18nKey="auth:acceptInvite" />
      </Button>

      <div>
        <div className="flex flex-col space-y-4">
          <p className="text-center">
            <span className="text-center text-sm text-gray-700 dark:text-gray-300">
              <Trans i18nKey="auth:acceptInviteWithDifferentAccount" />
            </span>
          </p>

          <div className="flex justify-center">
            <Button
              data-cy="invite-sign-out-button"
              disabled={isSubmitting}
              onClick={onSignOut}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trans i18nKey="auth:signOut" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExistingUserInviteForm;
