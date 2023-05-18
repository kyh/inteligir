"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import configuration from "~/configuration";
import If from "~/components/If";
import EmailLinkAuth from "~/app/auth/components/EmailLinkAuth";
import EmailPasswordSignUpContainer from "~/app/auth/components/EmailPasswordSignUpContainer";
import OAuthProviders from "~/app/auth/components/OAuthProviders";
import PhoneNumberSignInContainer from "~/app/auth/components/PhoneNumberSignInContainer";

function SignUpMethodsContainer() {
  const router = useRouter();

  const onSignUp = useCallback(() => {
    router.push(configuration.paths.onboarding);
  }, [router]);

  return (
    <>
      <OAuthProviders />

      <If condition={configuration.auth.providers.emailPassword}>
        <div>
          <span className="text-xs text-zinc-400">or continue with email</span>
        </div>

        <EmailPasswordSignUpContainer onSignUp={onSignUp} />
      </If>

      <If condition={configuration.auth.providers.phoneNumber}>
        <PhoneNumberSignInContainer onSignIn={onSignUp} />
      </If>

      <If condition={configuration.auth.providers.emailLink}>
        <EmailLinkAuth />
      </If>
    </>
  );
}

export default SignUpMethodsContainer;
