"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Provider } from "@supabase/gotrue-js/src/lib/types";
import If from "ui/components/if";
import OAuthProviders from "./oauth-providers";
import EmailPasswordSignInContainer from "./email-password-sign-in-container";
import PhoneNumberSignInContainer from "./phone-number-sign-in-container";
import EmailLinkAuth from "./email-link-auth";

const providers = {
  emailPassword: true,
  phoneNumber: false,
  emailLink: false,
  oAuth: ["google"] as Provider[],
};

const SignInMethodsContainer = () => {
  const router = useRouter();

  const onSignIn = useCallback(() => {
    router.replace("/dashboard");
  }, [router]);

  return (
    <>
      <If condition={providers.oAuth.length}>
        <OAuthProviders />
        <div>
          <span className="text-xs text-gray-400">Or continue with email</span>
        </div>
      </If>

      <If condition={providers.emailPassword}>
        <EmailPasswordSignInContainer onSignIn={onSignIn} />
      </If>

      <If condition={providers.phoneNumber}>
        <PhoneNumberSignInContainer mode="signIn" onSuccess={onSignIn} />
      </If>

      <If condition={providers.emailLink}>
        <EmailLinkAuth />
      </If>
    </>
  );
};

export default SignInMethodsContainer;
