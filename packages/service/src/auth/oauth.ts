import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { oauthProvider } from "@better-auth/oauth-provider";
import { CONNECTOR_CONSENT_PATH } from "@repo/contract/connector";
import { SIGN_IN_PATH } from "@repo/contract/library-page";

import {
  CONNECTOR_RESOURCE,
  CONNECTOR_SCOPES,
  hashOAuthToken,
  OAUTH_TOKEN_PREFIX,
} from "./oauth-auth";

const DAY_SECONDS = 86_400;

export const OAUTH_REGISTER_WINDOW_SECONDS = 3600;

export const oauthPlugins = () =>
  [
    oauthProvider({
      accessTokenExpiresIn: 3600,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: "infer",
      clientRegistrationDefaultResources: [CONNECTOR_RESOURCE],
      clientRegistrationRequirePKCE: true,
      consentPage: CONNECTOR_CONSENT_PATH,
      disableJwtPlugin: true,
      grantTypes: ["authorization_code", "refresh_token"],
      loginPage: SIGN_IN_PATH,
      prefix: { opaqueAccessToken: OAUTH_TOKEN_PREFIX },
      rateLimit: {
        register: { max: 10, window: OAUTH_REGISTER_WINDOW_SECONDS },
        token: { max: 60, window: 60 },
      },
      refreshTokenExpiresIn: 30 * DAY_SECONDS,
      resources: [CONNECTOR_RESOURCE],
      scopes: [...CONNECTOR_SCOPES],
      storeTokens: { hash: (token) => hashOAuthToken(token) },
    }),
    cimd({ fetchClientMetadataResource }),
  ] as const;
