"use client";

import { useCallback, useState, useTransition } from "react";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import { acceptInviteAction } from "@/features/memberships/actions";
import isBrowser from "@/lib/utils/is-browser";
import EmailLinkAuth from "@/app/auth/components/EmailLinkAuth";
import OAuthProviders from "@/app/auth/components/OAuthProviders";
import PhoneNumberSignInContainer from "@/app/auth/components/PhoneNumberSignInContainer";
import EmailPasswordSignInContainer from "@/app/auth/components/EmailPasswordSignInContainer";
import EmailPasswordSignUpContainer from "@/app/auth/components/EmailPasswordSignUpContainer";
import If from "ui/components/If";
import Button from "ui/components/Button";
import Trans from "ui/components/Trans";
import configuration from "@/configuration";
import PageLoadingIndicator from "ui/components/PageLoadingIndicator";

enum Mode {
  SignUp,
  SignIn,
}

const NewUserInviteForm = (
  props: React.PropsWithChildren<{
    code: string;
  }>,
) => {
  const [mode, setMode] = useState<Mode>(Mode.SignUp);
  const [isSubmitting, startTransition] = useTransition();
  const csrfToken = useCsrfToken();

  const oAuthReturnUrl = isBrowser() ? window.location.pathname : "";

  const onInviteAccepted = useCallback(
    async (userId?: string) => {
      startTransition(async () => {
        await acceptInviteAction({
          code: props.code,
          userId,
          csrfToken,
        });
      });
    },
    [csrfToken, props.code],
  );

  return (
    <>
      <If condition={isSubmitting}>
        <PageLoadingIndicator fullPage>
          Accepting invite. Please wait...
        </PageLoadingIndicator>
      </If>

      <OAuthProviders returnUrl={oAuthReturnUrl} />

      <If condition={configuration.auth.providers.emailPassword}>
        <If condition={mode === Mode.SignUp}>
          <div className="flex w-full flex-col items-center space-y-4">
            <EmailPasswordSignUpContainer onSignUp={onInviteAccepted} />

            <Button
              block
              onClick={() => {
                setMode(Mode.SignIn);
              }}
              size="sm"
              variant="ghost"
            >
              <Trans i18nKey="auth:alreadyHaveAccountStatement" />
            </Button>
          </div>
        </If>

        <If condition={mode === Mode.SignIn}>
          <div className="flex w-full flex-col items-center space-y-4">
            <EmailPasswordSignInContainer onSignIn={onInviteAccepted} />

            <Button
              block
              onClick={() => {
                setMode(Mode.SignUp);
              }}
              size="sm"
              variant="ghost"
            >
              <Trans i18nKey="auth:doNotHaveAccountStatement" />
            </Button>
          </div>
        </If>
      </If>

      <If condition={configuration.auth.providers.phoneNumber}>
        <PhoneNumberSignInContainer
          mode="signUp"
          onSuccess={onInviteAccepted}
        />
      </If>

      <If condition={configuration.auth.providers.emailLink}>
        <EmailLinkAuth inviteCode={props.code} />
      </If>
    </>
  );
};

export default NewUserInviteForm;
