// The connector's sign-in: OAuth 2.1 with PKCE on Better Auth's provider, an assistant registered
// by its metadata document (cimd) or by itself, opaque tokens stored hashed and minted for the
// connector alone. The person signs in and answers on the site's own pages; Settings lists and
// disconnects (./connected-assistants), so the provider's own consent and client routes stay shut
// at the door (./auth-route).

import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { oauthProvider } from "@better-auth/oauth-provider";
import { CONNECTOR_CONSENT_PATH } from "@repo/contract/connector";
import { SIGN_IN_PATH } from "@repo/contract/library-page";

import { RELAYED_FETCH } from "../fill/relayed-page-fetch";
import {
  CONNECTOR_RESOURCE,
  CONNECTOR_SCOPES,
  hashOAuthToken,
  OAUTH_TOKEN_PREFIX,
} from "./oauth-auth";

const DAY_SECONDS = 86_400;

// Better Auth's longest window, so the one its prune of rate_limit waits out (../rate-limit.ts)
export const OAUTH_REGISTER_WINDOW_SECONDS = 3600;

// Made per auth instance: the provider keeps the extensions registered with it, so one list shared
// by two instances would register cimd twice.
export const oauthPlugins = () =>
  [
    oauthProvider({
      accessTokenExpiresIn: 3600,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: "infer",
      // CIMD links an assistant to a resource only through this list; without it, every
      // assistant registered by its document is refused as invalid_target
      clientRegistrationDefaultResources: [CONNECTOR_RESOURCE],
      clientRegistrationRequirePKCE: true,
      consentPage: CONNECTOR_CONSENT_PATH,
      disableJwtPlugin: true,
      // a person connects an assistant: no token is minted without one
      grantTypes: ["authorization_code", "refresh_token"],
      loginPage: SIGN_IN_PATH,
      prefix: { opaqueAccessToken: OAUTH_TOKEN_PREFIX },
      rateLimit: {
        register: { max: 10, window: OAUTH_REGISTER_WINDOW_SECONDS },
        token: { max: 60, window: 60 },
      },
      // an assistant left unused a month signs in again
      refreshTokenExpiresIn: 30 * DAY_SECONDS,
      resources: [CONNECTOR_RESOURCE],
      scopes: [...CONNECTOR_SCOPES],
      storeTokens: { hash: (token) => hashOAuthToken(token) },
    }),
    // cimd's own transport refuses every host a test can serve, so the e2e's relay stands in
    cimd({ fetchClientMetadataResource: RELAYED_FETCH ?? fetchClientMetadataResource }),
  ] as const;
