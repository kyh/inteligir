// The connector's grants: the resource every access token is minted for, how a token is stored, and
// whom a token acts for now. A call re-reads its grant, so a disconnect in Settings or a narrowed
// consent reaches a live token at once, and a token is no session: it reaches the library alone.

import { createHash } from "node:crypto";

import { CONNECTOR_PATH } from "@repo/contract/connector";
import { oauthAccessToken, oauthClient, oauthConsent } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { and, eq } from "drizzle-orm";

import { APP_URL } from "../app-url";
import type { ConnectorPrincipal, LibraryScope } from "../library/library-principal";

// the protected resource (RFC 8707) a token is for, which a person adds to their assistant: never
// another of the deployment's, since the provider refuses a token minted for any other
export const CONNECTOR_RESOURCE = `${APP_URL}${CONNECTOR_PATH}`;

export const CONNECTOR_RESOURCE_METADATA_URL = `${APP_URL}/.well-known/oauth-protected-resource${CONNECTOR_PATH}`;

export const OAUTH_ISSUER = `${APP_URL}/api/auth`;

// the order a grant's scopes rank in, the last held the one it acts with
const LIBRARY_SCOPES: readonly LibraryScope[] = ["library:read", "library"];

// offline_access is what lets an assistant refresh, so it stays connected past an hour
export const CONNECTOR_SCOPES: readonly string[] = [...LIBRARY_SCOPES, "offline_access"];

// every access token starts with it, and is stored without it
export const OAUTH_TOKEN_PREFIX = "ito_";

// as the provider stores its tokens and codes
export const hashOAuthToken = (token: string): string =>
  createHash("sha256").update(token).digest("base64url");

// the library scopes a grant holds, `library` implying `library:read`
export const libraryScopesOf = (granted: readonly string[]): LibraryScope[] =>
  LIBRARY_SCOPES.filter((scope) => granted.includes(scope));

const CIMD_DISCOVERY = "cimd";
const NAME_MAX_LENGTH = 60;

export interface AssistantIdentity {
  readonly name: string;
  // the host of the metadata document that vouches for it, null for one that registered itself
  readonly verifiedDomain: string | null;
}

// A metadata document's id is its URL, so its host vouches for the assistant; a name it registered
// is only its own claim.
export const assistantIdentity = (client: {
  readonly clientDiscoveryId: string | null;
  readonly clientId: string;
  readonly name: string | null;
}): AssistantIdentity => {
  const verifiedDomain =
    client.clientDiscoveryId === CIMD_DISCOVERY && URL.canParse(client.clientId)
      ? new URL(client.clientId).host
      : null;
  const claimed = (client.name ?? "").trim().slice(0, NAME_MAX_LENGTH);
  return { name: claimed === "" ? (verifiedDomain ?? "An assistant") : claimed, verifiedDomain };
};

type ConnectorAuth =
  | { readonly ok: true; readonly principal: ConnectorPrincipal }
  | { readonly ok: false; readonly message: string };

const refuse = (message: string): ConnectorAuth => ({ message, ok: false });

// never throws for a bad token: the refusal says why, in words the assistant shows its person
export const authenticateConnectorToken = async (token: string): Promise<ConnectorAuth> => {
  if (!token.startsWith(OAUTH_TOKEN_PREFIX)) {
    return refuse("That isn't an access token for this library.");
  }
  const [found] = await db
    .select({
      client: {
        clientDiscoveryId: oauthClient.clientDiscoveryId,
        clientId: oauthClient.clientId,
        disabled: oauthClient.disabled,
        name: oauthClient.name,
      },
      consent: { id: oauthConsent.id, scopes: oauthConsent.scopes },
      token: {
        expiresAt: oauthAccessToken.expiresAt,
        resources: oauthAccessToken.resources,
        revoked: oauthAccessToken.revoked,
        scopes: oauthAccessToken.scopes,
        userId: oauthAccessToken.userId,
      },
    })
    .from(oauthAccessToken)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthAccessToken.clientId))
    .leftJoin(
      oauthConsent,
      and(
        eq(oauthConsent.clientId, oauthAccessToken.clientId),
        eq(oauthConsent.userId, oauthAccessToken.userId),
      ),
    )
    .where(eq(oauthAccessToken.token, hashOAuthToken(token.slice(OAUTH_TOKEN_PREFIX.length))))
    .limit(1);
  if (found === undefined) {
    return refuse("That isn't an access token for this library.");
  }
  const { client, consent, token: presented } = found;
  if (presented.revoked !== null || presented.expiresAt === null) {
    return refuse("This access token has expired or was revoked.");
  }
  if (presented.expiresAt.getTime() <= Date.now()) {
    return refuse("This access token has expired or was revoked.");
  }
  if (presented.resources?.includes(CONNECTOR_RESOURCE) !== true) {
    return refuse("This access token isn't for this library.");
  }
  if (consent === null || presented.userId === null) {
    return refuse("This assistant was disconnected. Connect it again.");
  }
  if (client.disabled === true) {
    return refuse("This assistant has been turned off.");
  }
  const scopes = libraryScopesOf(
    presented.scopes.filter((scope) => consent.scopes.includes(scope)),
  );
  if (scopes.length === 0) {
    return refuse("This assistant's connection reaches nothing in the library. Connect it again.");
  }
  return {
    ok: true,
    principal: {
      accountId: presented.userId,
      actor: {
        clientId: client.clientId,
        clientName: assistantIdentity(client).name,
        grantId: consent.id,
        kind: "assistant",
        scopes,
      },
    },
  };
};
