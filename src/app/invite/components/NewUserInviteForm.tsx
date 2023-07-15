"use client";;
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { siteConfig } from "~/config/site";
import isBrowser from "~/core/generic/is-browser";
import { Alert } from "~/components/Alert";
import { Button } from "~/components/Button";
import If from "~/components/If";
import PageLoadingIndicator from "~/components/PageLoadingIndicator";
import EmailLinkAuth from "~/app/auth/components/EmailLinkAuth";
import EmailPasswordSignInContainer from "~/app/auth/components/EmailPasswordSignInContainer";
import EmailPasswordSignUpContainer from "~/app/auth/components/EmailPasswordSignUpContainer";
import OAuthProviders from "~/app/auth/components/OAuthProviders";
import PhoneNumberSignInContainer from "~/app/auth/components/PhoneNumberSignInContainer";
import useAcceptInvite from "~/app/invite/use-accept-invite";

enum Mode {
  SignUp,
  SignIn,
}

const NewUserInviteForm = () => {
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
        return router.push("/dashboard");
      }
    },
    [acceptInvite, router]
  );

  if (acceptInvite.data?.verifyEmail) {
    return (
      <Alert type="success" heading="We sent you a confirmation email.">
        Welcome! Please check your email and click the link to verify your
        account.
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
      <If condition={siteConfig.auth.providers.emailPassword}>
        <If condition={mode === Mode.SignUp}>
          <div className="flex w-full flex-col items-center space-y-4">
            <EmailPasswordSignUpContainer onSubmit={onInviteAccepted} />
            <Button onClick={() => setMode(Mode.SignIn)}>
              I already have an account, I want to sign in instead
            </Button>
          </div>
        </If>
        <If condition={mode === Mode.SignIn}>
          <div className="flex w-full flex-col items-center space-y-4">
            <EmailPasswordSignInContainer onSignIn={onInviteAccepted} />
            <Button onClick={() => setMode(Mode.SignUp)}>
              I do not have an account, I want to sign up instead
            </Button>
          </div>
        </If>
      </If>
      <If condition={siteConfig.auth.providers.phoneNumber}>
        <PhoneNumberSignInContainer
          onSuccess={onInviteAccepted}
          mode="signUp"
        />
      </If>
      <If condition={siteConfig.auth.providers.emailLink}>
        <EmailLinkAuth />
      </If>
    </>
  );
};

export default NewUserInviteForm;
