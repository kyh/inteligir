// An assistant connected as it connects for real, through `/api/auth/*` as the app mounts it: it
// registers itself, sends the person to authorize with PKCE, the person answers on the consent page
// (its form's POST), and it trades the code for tokens; then it calls `/connector`.

import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";

import { CONNECTOR_CONSENT_PATH } from "@repo/contract/connector";
import { expect } from "vitest";
import { z } from "zod";

import { CONNECTOR_RESOURCE, OAUTH_ISSUER } from "../auth/oauth-auth";
import { handleConnectorRequest } from "../mcp/connector-server";
import { authFetch, ORIGIN } from "./auth-requests";

const registeredSchema = z.object({ client_id: z.string() });
const answeredSchema = z.object({ redirect: z.literal(true), url: z.string() });
const tokensSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  scope: z.string(),
  token_type: z.string(),
});

export type Tokens = z.infer<typeof tokensSchema>;

const form = (fields: Record<string, string>) => ({
  body: new URLSearchParams(fields).toString(),
  headers: { "content-type": "application/x-www-form-urlencoded" },
  method: "POST" as const,
});

const TOKEN_URL = `${OAUTH_ISSUER}/oauth2/token`;

const ecPublicJwkSchema = z.object({
  crv: z.string(),
  kty: z.string(),
  x: z.string(),
  y: z.string(),
});

const base64url = (text: string): string => Buffer.from(text).toString("base64url");

interface ProofClaims {
  // JSON leaves it out when no token is presented
  readonly ath: string | undefined;
  readonly htm: string;
  readonly htu: string;
  readonly iat: number;
  readonly jti: string;
}

export interface DpopKey {
  // a DPoP proof (RFC 9449) of this key for a request, presenting `accessToken` when given
  readonly proof: (method: string, url: string, accessToken?: string) => string;
}

export const dpopKey = (): DpopKey => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = ecPublicJwkSchema.parse(publicKey.export({ format: "jwk" }));
  return {
    proof: (method, url, accessToken) => {
      const claims: ProofClaims = {
        ath:
          accessToken === undefined
            ? undefined
            : createHash("sha256").update(accessToken).digest("base64url"),
        htm: method,
        htu: url,
        iat: Math.floor(Date.now() / 1000),
        jti: randomUUID(),
      };
      const header = JSON.stringify({ alg: "ES256", jwk, typ: "dpop+jwt" });
      const input = `${base64url(header)}.${base64url(JSON.stringify(claims))}`;
      const signature = sign("sha256", Buffer.from(input), {
        dsaEncoding: "ieee-p1363",
        key: privateKey,
      });
      return `${input}.${signature.toString("base64url")}`;
    },
  };
};

export const registerAssistant = async (name: string, redirectUri: string): Promise<string> => {
  const response = await authFetch("/oauth2/register", {
    body: JSON.stringify({
      client_name: name,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [redirectUri],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(201);
  return registeredSchema.parse(await response.json()).client_id;
};

interface Connecting {
  readonly cookie: string;
  // what the assistant asks for
  readonly scope: string;
  // what the person allows, as the consent page sends it
  readonly allowed: string;
  // the key an assistant binds its tokens to, if it holds one
  readonly dpop?: DpopKey;
}

// the person's session authorizes, answers the consent page, and the code is traded
export const connectAssistant = async (
  name: string,
  { allowed, cookie, dpop, scope }: Connecting,
): Promise<{ readonly clientId: string; readonly tokens: Tokens }> => {
  const redirectUri = `https://${name.toLowerCase()}.example/callback`;
  const clientId = await registerAssistant(name, redirectUri);
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(8).toString("hex");
  const authorize = new URLSearchParams({
    client_id: clientId,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    resource: CONNECTOR_RESOURCE,
    response_type: "code",
    scope,
    state,
  });
  const asked = await authFetch(`/oauth2/authorize?${authorize.toString()}`, {
    headers: { cookie },
  });
  const consentPage = new URL(asked.headers.get("location") ?? "", ORIGIN);
  expect(consentPage.pathname).toBe(CONNECTOR_CONSENT_PATH);

  const answered = await authFetch("/oauth2/consent", {
    body: JSON.stringify({
      accept: true,
      oauth_query: consentPage.search.slice(1),
      scope: allowed,
    }),
    headers: { "content-type": "application/json", cookie, origin: ORIGIN },
    method: "POST",
  });
  expect(answered.status).toBe(200);
  const back = new URL(answeredSchema.parse(await answered.json()).url);
  expect(back.searchParams.get("state")).toBe(state);

  const exchange = form({
    client_id: clientId,
    code: back.searchParams.get("code") ?? "",
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    resource: CONNECTOR_RESOURCE,
  });
  const traded = await authFetch(
    "/oauth2/token",
    dpop === undefined
      ? exchange
      : { ...exchange, headers: { ...exchange.headers, dpop: dpop.proof("POST", TOKEN_URL) } },
  );
  expect(traded.status).toBe(200);
  return { clientId, tokens: tokensSchema.parse(await traded.json()) };
};

export const refreshTokens = async (clientId: string, refreshToken: string): Promise<Response> =>
  await authFetch(
    "/oauth2/token",
    form({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      resource: CONNECTOR_RESOURCE,
    }),
  );

export const tokensOf = async (response: Response): Promise<Tokens> =>
  tokensSchema.parse(await response.json());

interface ConnectorInit {
  readonly bearer?: string;
  readonly body?: JsonRpcBody;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: "DELETE" | "GET" | "POST";
  // a DPoP proof, sent as its header
  readonly proof?: string;
}

type JsonRpcBody = z.infer<ReturnType<typeof z.json>>;

// `/connector` as the app mounts it, a 2025-era client's request unless the headers say otherwise
export const connectorFetch = async ({
  bearer,
  body,
  headers = {},
  method = "POST",
  proof,
}: ConnectorInit): Promise<Response> => {
  const sent = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-06-18",
  });
  if (bearer !== undefined) {
    sent.set("authorization", `Bearer ${bearer}`);
  }
  if (proof !== undefined) {
    sent.set("dpop", proof);
  }
  for (const [name, value] of Object.entries(headers)) {
    sent.set(name, value);
  }
  return await handleConnectorRequest(
    new Request(CONNECTOR_RESOURCE, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: sent,
      method,
    }),
  );
};

let rpcId = 0;

export const rpc = (method: string, params: JsonRpcBody = {}): JsonRpcBody => {
  rpcId += 1;
  return { id: rpcId, jsonrpc: "2.0", method, params };
};
