"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import configuration from "~/configuration";
import If from "~/components/If";
import EmailLinkAuth from "~/app/auth/components/EmailLinkAuth";
import EmailPasswordSignInContainer from "~/app/auth/components/EmailPasswordSignInContainer";
import OAuthProviders from "~/app/auth/components/OAuthProviders";
import PhoneNumberSignInContainer from "~/app/auth/components/PhoneNumberSignInContainer";

function SignInMethodsContainer() {
  const router = useRouter();

  const onSignIn = useCallback(() => {
    router.push(configuration.paths.appHome);
  }, [router]);

  return (
    <>
      <OAuthProviders />
      <If condition={configuration.auth.providers.emailPassword}>
        <div>
          <span className="text-xs text-zinc-400">or continue with email</span>
        </div>
        <EmailPasswordSignInContainer onSignIn={onSignIn} />
      </If>
      <If condition={configuration.auth.providers.phoneNumber}>
        <PhoneNumberSignInContainer onSignIn={onSignIn} />
      </If>
      <If condition={configuration.auth.providers.emailLink}>
        <EmailLinkAuth />
      </If>
    </>
  );
}

export default SignInMethodsContainer;
