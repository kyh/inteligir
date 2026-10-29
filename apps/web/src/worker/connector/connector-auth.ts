// The connector's OAuth, all of it `@cloudflare/workers-oauth-provider`'s
// (github.com/cloudflare/workers-oauth-provider/blob/main/docs/resource-servers.md, the "Same
// Worker" shape): the authorization server serves its metadata, token, revocation and
// registration endpoints and validates its own tokens, and the resource server, the connector
// itself, publishes its RFC 9728 metadata, challenges a call with no valid token and admits only
// tokens minted for its own address. Both are named from one per-deployment origin, never the
// request's Host, so a Preview's tokens are its own; KV holds the clients, grants and tokens, and
// nothing else. The consent page is this Worker's (`./consent-route`).

import { CONNECTOR_PATH } from "@repo/contract/cloud/connector";
import { OAuthAuthorizationServer, OAuthResourceServer } from "@cloudflare/workers-oauth-provider";
import type {
  OAuthHelpers,
  OAuthResourceHandler,
  OAuthResourceTokenValidation,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";

import { LIBRARY_SCOPES } from "../library/library-principal";

// the person's own page, which signs them in and asks; the provider advertises it and refuses a
// request parsed anywhere else
export const CONSENT_PATH = "/connect/authorize";

const TOKEN_PATH = "/oauth/token";
const REGISTRATION_PATH = "/oauth/register";

// the scope any access needs, which a client asks for first; the consent page grants it, or
// `library` with it, as the person chooses
export const READ_SCOPE = "library:read";

const DAY_SECONDS = 24 * 60 * 60;

// a client that registered itself and stopped using it goes after 90 days (one in use is renewed)
const REGISTRATION_TTL_SECONDS = 90 * DAY_SECONDS;
// a grant lives 30 days from its last refresh, so one an assistant keeps using never lapses
const GRANT_IDLE_TTL_SECONDS = 30 * DAY_SECONDS;

// what a grant keeps: whose library, and the client's name as it gave it on the consent page,
// which History and the account's list of assistants show
const grantPropsSchema = z.strictObject({
  accountId: z.string().min(1).max(128),
  clientName: z.string().min(1).max(128),
});

// an access token's: its grant's, and the grant it was minted under, which the token alone does not
// say and every call's change set and budget are keyed on
const tokenPropsSchema = grantPropsSchema.extend({
  grantId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
});

export type TokenProps = z.infer<typeof tokenPropsSchema>;

// the grant's metadata, which a listing reads unencrypted
export const grantMetadataSchema = z.strictObject({ clientName: z.string().min(1).max(128) });

// the deployment's origin as the config declares it: an https origin, or http on a loopback host
// under `vite dev` and the e2e harness
const siteOriginSchema = z.url({ protocol: /^https?$/u }).transform((value, issue) => {
  const { origin } = new URL(value);
  if (origin !== value) {
    issue.addIssue({ code: "custom", message: "SITE_ORIGIN is an origin, with no path" });
    return z.NEVER;
  }
  return origin;
});

const connectorResourceOf = (origin: string): string => `${origin}${CONNECTOR_PATH}`;

const logRefusal = (refusal: {
  code: string;
  status: number;
  internal: { readonly reason?: string | undefined };
}): void => {
  console.warn({
    code: refusal.code,
    event: "connector-oauth-refused",
    reason: refusal.internal.reason ?? null,
    status: refusal.status,
  });
};

const authorizationServerAt = (origin: string): OAuthAuthorizationServer<Env> =>
  new OAuthAuthorizationServer<Env>({
    authorizeEndpoint: CONSENT_PATH,
    clientIdMetadataDocumentEnabled: true,
    clientRegistrationEndpoint: REGISTRATION_PATH,
    clientRegistrationTTL: REGISTRATION_TTL_SECONDS,
    issuer: origin,
    onError: logRefusal,
    refreshTokenIdleTTL: GRANT_IDLE_TTL_SECONDS,
    resources: [connectorResourceOf(origin)],
    scopesSupported: [...LIBRARY_SCOPES],
    // the grant id rides each access token's props: a refresh mints a new token under the same
    // grant, and the code exchange is the first moment the grant has one
    tokenExchangeCallback: ({ grantId, props }) => ({
      accessTokenProps: { ...grantPropsSchema.parse(props), grantId },
    }),
    tokenEndpoint: TOKEN_PATH,
  });

// the token is this Worker's own; a grant whose props this build does not read is no grant, and
// answers the challenge a client signs in again from
const validatedToken = async (
  authorizationServer: OAuthAuthorizationServer<Env>,
  env: Env,
  presented: { readonly resource: string; readonly token: string },
): Promise<OAuthResourceTokenValidation<TokenProps> | null> => {
  const validated = await authorizationServer.validateToken(
    presented.resource,
    presented.token,
    env,
  );
  const tokenProps = tokenPropsSchema.safeParse(validated?.props);
  return validated === null || !tokenProps.success
    ? null
    : { ...validated, props: tokenProps.data };
};

export interface ConnectorAuth {
  readonly origin: string;
  readonly resource: string;
  readonly authorizationServer: OAuthAuthorizationServer<Env>;
  readonly helpers: OAuthHelpers;
  // the connector behind its token check, answering with `handler` once a token validates
  readonly resourceServer: (
    handler: OAuthResourceHandler<Env, TokenProps>,
  ) => OAuthResourceServer<Env, TokenProps>;
}

// the deployment's pair, named from the origin it declares; each is a few objects to build, so
// every request builds its own and nothing outlives it
export const connectorAuth = (env: Env): ConnectorAuth => {
  const origin = siteOriginSchema.parse(env.SITE_ORIGIN);
  const authorizationServer = authorizationServerAt(origin);
  const resource = connectorResourceOf(origin);
  return {
    authorizationServer,
    helpers: authorizationServer.getOAuthApi(env),
    origin,
    resource,
    resourceServer: (handler) =>
      new OAuthResourceServer<Env, TokenProps>({
        handler,
        requiredScopes: [READ_SCOPE],
        resourceMetadata: {
          authorization_servers: [origin],
          resource,
          resource_name: "Inteligir library",
        },
        validateToken: (validateEnv) => async (forResource, token) =>
          await validatedToken(authorizationServer, validateEnv, {
            resource: forResource,
            token,
          }),
      }),
  };
};

// the paths the authorization server answers itself: its metadata, token, revocation and
// registration endpoints
export const isAuthorizationServerPath = (pathname: string): boolean =>
  pathname === "/.well-known/oauth-authorization-server" ||
  pathname === TOKEN_PATH ||
  pathname === REGISTRATION_PATH;

// the connector and its RFC 9728 document, which its resource server answers
export const isConnectorPath = (pathname: string): boolean =>
  pathname === CONNECTOR_PATH ||
  pathname.startsWith(`${CONNECTOR_PATH}/`) ||
  pathname === `/.well-known/oauth-protected-resource${CONNECTOR_PATH}`;
