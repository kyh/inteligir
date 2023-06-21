"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { siteConfig } from "~/config/site";
import If from "~/components/If";
import EmailLinkAuth from "~/app/auth/components/EmailLinkAuth";
import EmailPasswordSignInContainer from "~/app/auth/components/EmailPasswordSignInContainer";
import OAuthProviders from "~/app/auth/components/OAuthProviders";
import PhoneNumberSignInContainer from "~/app/auth/components/PhoneNumberSignInContainer";

function SignInMethodsContainer() {
  const router = useRouter();

  const onSignIn = useCallback(() => {
    router.push("/dashboard");
  }, [router]);

  return (
    <>
      <OAuthProviders />
      <If condition={siteConfig.auth.providers.emailPassword}>
        <div className="text-xs text-zinc-400">or continue with email</div>
        <EmailPasswordSignInContainer onSignIn={onSignIn} />
      </If>
      <If condition={siteConfig.auth.providers.phoneNumber}>
        <PhoneNumberSignInContainer onSuccess={onSignIn} mode={"signIn"} />
      </If>
      <If condition={siteConfig.auth.providers.emailLink}>
        <EmailLinkAuth />
      </If>
    </>
  );
}

export default SignInMethodsContainer;
