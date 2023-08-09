"use client";

import { useCallback } from "react";
import Image from "next/image";
import { siteConfig } from "~/config/site";
import { MailIcon, PhoneIcon } from "lucide-react";
import useSignInWithProvider from "~/core/hooks/use-sign-in-with-provider";
import { Button } from "~/components/Button";
import { If } from "~/components/If";
import PageLoadingIndicator from "~/components/PageLoadingIndicator";

const OAUTH_PROVIDERS = siteConfig.auth.providers.oAuth;

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
                  const callback = "/auth/callback";

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
              >
                Connect with <span className="capitalize">{provider}</span>
              </AuthProviderButton>
            );
          })}
        </div>
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

const getOAuthProviderLogos = (): Record<string, string | React.ReactNode> => {
  return {
    email: <MailIcon className="h-7" />,
    phone: <PhoneIcon className="h-7" />,
    google: "/assets/images/google.webp",
    facebook: "/assets/images/facebook.webp",
    twitter: "/assets/images/twitter.webp",
    github: "/assets/images/github.webp",
    microsoft: "/assets/images/microsoft.webp",
    apple: "/assets/images/apple.webp",
  };
};

export default OAuthProviders;
