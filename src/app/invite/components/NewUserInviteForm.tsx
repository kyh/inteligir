"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import EmailLinkAuth from "~/app/auth/components/EmailLinkAuth";
import OAuthProviders from "~/app/auth/components/OAuthProviders";
import PhoneNumberSignInContainer from "~/app/auth/components/PhoneNumberSignInContainer";
import EmailPasswordSignInContainer from "~/app/auth/components/EmailPasswordSignInContainer";
import EmailPasswordSignUpContainer from "~/app/auth/components/EmailPasswordSignUpContainer";

import If from "~/core/ui/If";
import Button from "~/core/ui/Button";
import Trans from "~/core/ui/Trans";
import Alert from "~/core/ui/Alert";

import configuration from "~/configuration";
import useAcceptInvite from "~/app/invite/use-accept-invite";
import PageLoadingIndicator from "~/core/ui/PageLoadingIndicator";
import isBrowser from "~/core/generic/is-browser";

enum Mode {
  SignUp,
  SignIn,
}

function NewUserInviteForm() {
  const [mode, setMode] = useState<Mode>(Mode.SignUp);
  const acceptInvite = useAcceptInvite();
  const router = useRouter();
  const oAuthReturnUrl = isBrowser() ? window.location.pathname : "";

  const onInviteAccepted = useCallback(
    async (userId?: string) => {
      const data = await acceptInvite.trigger({ userId });
      const shouldVerifyEmail = data?.verifyEmail;

      // if the user is *not* required to confirm their email
      // we redirect them to the app home
      if (!shouldVerifyEmail) {
        return router.push(configuration.paths.appHome);
      }
    },
    [acceptInvite, router]
  );

  if (acceptInvite.data?.verifyEmail) {
    return (
      <Alert type="success">
        <Alert.Heading>
          <Trans i18nKey="auth:emailConfirmationAlertHeading" />
        </Alert.Heading>

        <Trans i18nKey="auth:emailConfirmationAlertBody" />
      </Alert>
    );
  }

  return (
    <>
      <If condition={acceptInvite.isMutating}>
        <PageLoadingIndicator fullPage>
          Accepting invite. Please wait...
        </PageLoadingIndicator>
      </If>

      <OAuthProviders returnUrl={oAuthReturnUrl} />

      <If condition={configuration.auth.providers.emailPassword}>
        <If condition={mode === Mode.SignUp}>
          <div className="flex w-full flex-col items-center space-y-4">
            <EmailPasswordSignUpContainer onSubmit={onInviteAccepted} />

            <Button
              block
              color="transparent"
              size="small"
              onClick={() => setMode(Mode.SignIn)}
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
              color="transparent"
              size="small"
              onClick={() => setMode(Mode.SignUp)}
            >
              <Trans i18nKey="auth:doNotHaveAccountStatement" />
            </Button>
          </div>
        </If>
      </If>

      <If condition={configuration.auth.providers.phoneNumber}>
        <PhoneNumberSignInContainer onSignIn={onInviteAccepted} />
      </If>

      <If condition={configuration.auth.providers.emailLink}>
        <EmailLinkAuth />
      </If>
    </>
  );
}

export default NewUserInviteForm;
