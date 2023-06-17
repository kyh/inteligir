"use client";

import { useCallback } from "react";
import Image from "next/image";
import {
  AtSymbolIcon,
  DevicePhoneMobileIcon,
} from "@heroicons/react/24/outline";
import { config } from "~/config/site";
import useSignInWithProvider from "~/core/hooks/use-sign-in-with-provider";
import { Button } from "~/components/Button";
import If from "~/components/If";
import PageLoadingIndicator from "~/components/PageLoadingIndicator";
import AuthErrorMessage from "./AuthErrorMessage";

const OAUTH_PROVIDERS = config.auth.providers.oAuth;

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
    []
  );

  if (!OAUTH_PROVIDERS || !OAUTH_PROVIDERS.length) {
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
                providerId={provider}
                onClick={() => {
                  const origin = window.location.origin;
                  const signInFromLink = "/auth/link";

                  const returnUrlParams = props.returnUrl
                    ? `?returnUrl=${props.returnUrl}`
                    : "";

                  const returnUrl = [signInFromLink, returnUrlParams].join("");
                  const redirectTo = [origin, returnUrl].join("");

                  const credentials = {
                    provider,
                    options: {
                      redirectTo,
                    },
                  };

                  return onSignInWithProvider(() =>
                    signInWithProviderMutation.trigger(credentials)
                  );
                }}
              >
                Sign in with <span className="capitalize">{provider}</span>
              </AuthProviderButton>
            );
          })}
        </div>

        <AuthErrorMessage error={signInWithProviderMutation.error} />
      </div>
    </>
  );
};

const AuthProviderButton: React.FCC<{
  providerId: string;
  onClick: () => unknown;
}> = ({ children, providerId, onClick }) => {
  return (
    <Button
      className="relative w-full"
      data-cy="auth-provider-button"
      onClick={onClick}
      data-provider={providerId}
    >
      <span className="absolute left-3 flex items-center justify-start">
        <AuthProviderLogo providerId={providerId} />
      </span>
      <span className="flex w-full flex-1 items-center">
        <span className="flex w-full items-center justify-center">
          <span className="text-current">{children}</span>
        </span>
      </span>
    </Button>
  );
};

const DEFAULT_IMAGE_SIZE = 22;

const AuthProviderLogo: React.FC<{
  providerId: string;
  width?: number;
  height?: number;
}> = ({ providerId, width, height }) => {
  const image = getOAuthProviderLogos()[providerId];

  if (typeof image === `string`) {
    return (
      <Image
        decoding="async"
        loading="lazy"
        src={image}
        alt={`${providerId} logo`}
        width={width ?? DEFAULT_IMAGE_SIZE}
        height={height ?? DEFAULT_IMAGE_SIZE}
      />
    );
  }

  return <>{image}</>;
};

function getOAuthProviderLogos(): Record<string, string | JSX.Element> {
  return {
    email: <AtSymbolIcon className="h-7" />,
    phone: <DevicePhoneMobileIcon className="h-7" />,
    google: "/assets/images/google.webp",
    facebook: "/assets/images/facebook.webp",
    twitter: "/assets/images/twitter.webp",
    github: "/assets/images/github.webp",
    microsoft: "/assets/images/microsoft.webp",
    apple: "/assets/images/apple.webp",
  };
}

function getProviderName(providerId: string) {
  const capitalize = (value: string) =>
    value.slice(0, 1).toUpperCase() + value.slice(1);

  if (providerId.endsWith(".com")) {
    return capitalize(providerId.split(".com")[0]);
  }

  return capitalize(providerId);
}

export default OAuthProviders;
