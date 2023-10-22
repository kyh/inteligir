"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { If } from "@/components/if";
import Trans from "@inteligir/ui/trans";
import EmailPasswordSignUpContainer from "@/app/auth/components/email-password-sign-up-container";
import PhoneNumberSignInContainer from "@/app/auth/components/phone-number-sign-in-container";
import EmailLinkAuth from "@/app/auth/components/email-link-auth";
import OAuthProviders from "@/app/auth/components/oauth-providers";
import configuration from "@/configuration";

const SignUpMethodsContainer = () => {
  const router = useRouter();

  const onSignUp = useCallback(() => {
    const requireEmailConfirmation =
      configuration.auth.requireEmailConfirmation;

    // If the user is required to confirm their email, we show them a message
    if (requireEmailConfirmation) {
      return;
    }

    // Otherwise, we redirect them to the onboarding page
    router.push(configuration.paths.onboarding);
  }, [router]);

  return (<>
    <If condition={configuration.auth.providers.oAuth.length}>
      <OAuthProviders />

      <div>
        <span className="text-xs text-gray-400">
          or continue with email
        </span>
      </div>
    </If>
    <If condition={configuration.auth.providers.emailPassword}>
      <EmailPasswordSignUpContainer onSignUp={onSignUp} />
    </If>
    <If condition={configuration.auth.providers.phoneNumber}>
      <PhoneNumberSignInContainer mode="signUp" onSuccess={onSignUp} />
    </If>
    <If condition={configuration.auth.providers.emailLink}>
      <EmailLinkAuth />
    </If>
  </>);
};

export default SignUpMethodsContainer;
