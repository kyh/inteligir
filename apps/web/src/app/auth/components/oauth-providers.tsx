"use client";

import { useCallback } from "react";
import { If } from "@/components/if";
import { useSignInWithProvider } from "@/features/auth/use-sign-in-with-provider";
import { configuration } from "@/lib/configuration";
import AuthErrorMessage from "./auth-error-message";
import Trans from "@/components/trans";
import AuthProviderButton from "@/components/auth-provider-button";
import PageLoadingIndicator from "@/components/page-loading-indicator";

const OAUTH_PROVIDERS = configuration.auth.providers.oAuth;

const OAuthProviders: React.FCC<{
  returnUrl?: string;
}> = (props) => {
  const signInWithProviderMutation = useSignInWithProvider();

  // we make the UI "busy" until the next page is fully loaded
  const loading = signInWithProviderMutation.isMutating;

  const onSignInWithProvider = useCallback(
    async (signInRequest: () => Promise<unknown>) => {
      try {
        const credential = await signInRequest();

        if (!credential) {
          return Promise.reject();
        }
      } catch (error) {
        throw error;
      }
    },
    [],
  );

  if (!OAUTH_PROVIDERS.length) {
    return null;
  }

  return (
    <>
      <If condition={loading}>
        <PageLoadingIndicator />
      </If>
      <div className="flex w-full flex-1 flex-col space-y-3">
        <div className="flex-col space-y-2">
          {OAUTH_PROVIDERS.map((provider) => {
            return (
              <AuthProviderButton
                key={provider}
                onClick={() => {
                  const origin = window.location.origin;
                  const callback = configuration.paths.authCallback;

                  const returnUrlParams = props.returnUrl
                    ? `?returnUrl=${props.returnUrl}`
                    : "";

                  const returnUrl = [callback, returnUrlParams].join("");
                  const redirectTo = [origin, returnUrl].join("");

                  const credentials = {
                    provider,
                    options: {
                      redirectTo,
                    },
                  };

                  return onSignInWithProvider(() =>
                    signInWithProviderMutation.trigger(credentials),
                  );
                }}
                providerId={provider}
              >
                Sign in with {{ provider }}
              </AuthProviderButton>
            );
          })}
        </div>

        <AuthErrorMessage error={signInWithProviderMutation.error} />
      </div>
    </>
  );
};

const getProviderName = (providerId: string) => {
  const capitalize = (value: string) =>
    value.slice(0, 1).toUpperCase() + value.slice(1);

  if (providerId.endsWith(".com")) {
    return capitalize(providerId.split(".com")[0]);
  }

  return capitalize(providerId);
};

export default OAuthProviders;
