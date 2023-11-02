"use client";

import { useCallback, useState, useTransition } from "react";
import Button from "@inteligir/ui/button";
import PageLoadingIndicator from "@inteligir/ui/page-loading-indicator";
import useCsrfToken from "@/lib/csrf/use-csrf-token";
import { acceptInviteAction } from "@/features/memberships/actions";
import isBrowser from "@/lib/utils/is-browser";
import EmailLinkAuth from "@/app/auth/components/email-link-auth";
import OAuthProviders from "@/app/auth/components/oauth-providers";
import PhoneNumberSignInContainer from "@/app/auth/components/phone-number-sign-in-container";
import EmailPasswordSignInContainer from "@/app/auth/components/email-password-sign-in-container";
import EmailPasswordSignUpContainer from "@/app/auth/components/email-password-sign-up-container";
import { If } from "@/components/if";
import { configuration } from "@/lib/configuration";
import { EmailOtpContainer } from "@/app/auth/components/email-otp-container";

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
              I already have an account, I want to sign in instead
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
              I do not have an account, I want to sign up instead
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
      <If condition={configuration.auth.providers.emailOtp}>
        <EmailOtpContainer
          shouldCreateUser={true}
          onSuccess={onInviteAccepted}
        />
      </If>
    </>
  );
};

export default NewUserInviteForm;
