"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { If } from "@/components/if";
import OAuthProviders from "./oauth-providers";
import EmailPasswordSignInContainer from "./email-password-sign-in-container";
import PhoneNumberSignInContainer from "./phone-number-sign-in-container";
import EmailLinkAuth from "./email-link-auth";
import { EmailOtpContainer } from "./email-otp-container";
import { configuration } from "@/lib/configuration";

const SignInMethodsContainer = () => {
  const router = useRouter();

  const onSignIn = useCallback(() => {
    router.push("/dashboard");
  }, [router]);

  return (
    <>
      <If condition={configuration.auth.providers.oAuth.length}>
        <OAuthProviders />
        <div>
          <span className="text-xs text-gray-400">Or continue with email</span>
        </div>
      </If>

      <If condition={configuration.auth.providers.emailPassword}>
        <EmailPasswordSignInContainer onSignIn={onSignIn} />
      </If>

      <If condition={configuration.auth.providers.phoneNumber}>
        <PhoneNumberSignInContainer mode="signIn" onSuccess={onSignIn} />
      </If>

      <If condition={configuration.auth.providers.emailLink}>
        <EmailLinkAuth />
      </If>

      <If condition={configuration.auth.providers.emailOtp}>
        <EmailOtpContainer shouldCreateUser={false} />
      </If>
    </>
  );
};

export default SignInMethodsContainer;
