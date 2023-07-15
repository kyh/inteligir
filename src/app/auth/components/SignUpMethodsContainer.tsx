"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { siteConfig } from "~/config/site";
import If from "~/components/If";
import EmailLinkAuth from "~/app/auth/components/EmailLinkAuth";
import EmailPasswordSignUpContainer from "~/app/auth/components/EmailPasswordSignUpContainer";
import OAuthProviders from "~/app/auth/components/OAuthProviders";
import PhoneNumberSignInContainer from "~/app/auth/components/PhoneNumberSignInContainer";

const SignUpMethodsContainer = () => {
  const router = useRouter();

  const onSignUp = useCallback(() => {
    router.push("/onboarding");
  }, [router]);

  return (
    <>
      <If condition={siteConfig.auth.providers.oAuth.length}>
        <OAuthProviders />
      </If>
      <If condition={siteConfig.auth.providers.emailPassword}>
        <div className="text-xs text-zinc-400">or continue with email</div>
        <EmailPasswordSignUpContainer onSignUp={onSignUp} />
      </If>
      <If condition={siteConfig.auth.providers.phoneNumber}>
        <PhoneNumberSignInContainer onSuccess={onSignUp} mode="signUp" />
      </If>
      <If condition={siteConfig.auth.providers.emailLink}>
        <EmailLinkAuth />
      </If>
    </>
  );
};

export default SignUpMethodsContainer;
