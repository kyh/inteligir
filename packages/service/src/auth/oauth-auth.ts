import { createHash } from "node:crypto";

import { CONNECTOR_PATH } from "@repo/contract/connector";
import { oauthAccessToken, oauthClient, oauthConsent } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { getConfirmationJkt } from "better-auth/oauth2";
import { and, eq } from "drizzle-orm";

import { APP_URL } from "../app-url";
import type { ConnectorPrincipal, LibraryScope } from "../library/library-principal";

export const CONNECTOR_RESOURCE = `${APP_URL}${CONNECTOR_PATH}`;

export const CONNECTOR_RESOURCE_METADATA_URL = `${APP_URL}/.well-known/oauth-protected-resource${CONNECTOR_PATH}`;

export const OAUTH_ISSUER = `${APP_URL}/api/auth`;

const LIBRARY_SCOPES: readonly LibraryScope[] = ["library:read", "library"];

export const CONNECTOR_SCOPES: readonly string[] = [...LIBRARY_SCOPES, "offline_access"];

export const OAUTH_TOKEN_PREFIX = "ito_";

export const hashOAuthToken = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

export const libraryScopesOf = (granted: readonly string[]) =>
  LIBRARY_SCOPES.filter((scope) => granted.includes(scope));

const CIMD_DISCOVERY = "cimd";
const NAME_MAX_LENGTH = 60;

export interface AssistantIdentity {
  readonly name: string;
  readonly verifiedDomain: string | null;
}

export const assistantIdentity = (client: {
  readonly clientDiscoveryId: string | null;
  readonly clientId: string;
  readonly name: string | null;
}) => {
  const verifiedDomain =
    client.clientDiscoveryId === CIMD_DISCOVERY && URL.canParse(client.clientId)
      ? new URL(client.clientId).host
      : null;

  const claimed = (client.name ?? "").trim().slice(0, NAME_MAX_LENGTH);

  return {
    name: claimed === "" ? (verifiedDomain ?? "An assistant") : claimed,
    verifiedDomain,
  } satisfies AssistantIdentity;
};

type ConnectorAuth =
  | {
      readonly ok: true;
      readonly principal: ConnectorPrincipal;
      readonly dpopKey: string | null;
    }
  | { readonly ok: false; readonly message: string };

const refuse = (message: string) => ({ message, ok: false }) satisfies ConnectorAuth;

export const authenticateConnectorToken = async (token: string) => {
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
        confirmation: oauthAccessToken.confirmation,
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
    dpopKey: getConfirmationJkt(presented.confirmation) ?? null,
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
  } satisfies ConnectorAuth;
};
