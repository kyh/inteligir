// The built-in agent's own OAuth client of the connector, and the grant the cell completes for an
// account when the person turns the agent on. The client is public, so no secret sits in any vault,
// and first-party, so no consent page asks: the cell drives the provider's documented flow itself,
// in process, a Request to the consent path parsed by `parseAuthRequest`, `completeAuthorization`
// for the account with scope `library`, and the code traded with its PKCE verifier at the Worker's
// own token endpoint, the one Anthropic refreshes the token at; the provider's KV is never written
// by hand (github.com/cloudflare/workers-oauth-provider/blob/main/docs/consent-page.md). The
// provider mints a client's id, so the deployment's one client is registered by `createClient` the
// first time any account needs it, and its id is kept in D1 under the deployment's issuer, where
// every account's cell finds it.

import { hexFromBytes } from "@repo/contract/cloud/bytes";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { CONSENT_PATH, TOKEN_PATH } from "../connector/connector-auth";
import type { ConnectorAuth, GrantMetadata } from "../connector/connector-auth";
import { pkcePair } from "../connector/pkce";
import { createDb } from "../db/client";
import { builtInClient } from "../db/schema";

// the client's name, as its grant's props carry it to every call it makes
const BUILT_IN_CLIENT_NAME = "Built-in agent";

// the agent reads and changes the library, as an assistant let in without the read-only box does
const SCOPE = "library";

// where a code would be sent: an address of this deployment's own that serves nothing, since the
// cell reads the code from the authorization's answer and no browser ever follows it; the consent
// page refuses every request whose code would come here
const REDIRECT_PATH = "/connect/built-in-agent";

const redirectUriOf = (origin: string): string => `${origin}${REDIRECT_PATH}`;

// the token endpoint's answer to a code (RFC 6749 § 5.1), the refresh token included, since the
// vault refreshes with it
const tokenAnswerSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
});

// the Worker itself, whose token endpoint the cell trades the code at: `ctx.exports.default`
export interface TokenEndpoint {
  readonly fetch: (request: Request) => Promise<Response>;
}

export interface BuiltInGrant {
  readonly grantId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  // when the access token lapses, RFC 3339, as a vault credential takes it
  readonly expiresAt: string;
  // what the vault's credential refreshes with: the client, the endpoint, and the resource and
  // scope it asks for again
  readonly clientId: string;
  readonly tokenEndpoint: string;
  readonly resource: string;
  readonly scope: string;
}

const registerClient = async (auth: ConnectorAuth): Promise<string> => {
  const client = await auth.helpers.createClient({
    clientName: BUILT_IN_CLIENT_NAME,
    grantTypes: ["authorization_code", "refresh_token"],
    redirectUris: [redirectUriOf(auth.origin)],
    responseTypes: ["code"],
    tokenEndpointAuthMethod: "none",
  });
  return client.clientId;
};

// the deployment's client, registered on the first need. A row whose client the provider no longer
// holds (a namespace made anew under a kept database) is replaced, and of two cells registering at
// once the first row stands and the other's client goes unused; a deletion scans every grant, but
// a client registered a moment ago holds none, and this happens once a deployment
export const builtInClientId = async (env: Env, auth: ConnectorAuth): Promise<string> => {
  const db = createDb(env.DB);
  const issuer = auth.origin;
  const held = await db.select().from(builtInClient).where(eq(builtInClient.issuer, issuer)).get();
  if (held !== undefined && (await auth.helpers.lookupClient(held.clientId)) !== null) {
    return held.clientId;
  }
  const minted = await registerClient(auth);
  const claim = db.insert(builtInClient).values({ clientId: minted, issuer });
  const won = await (
    held === undefined
      ? claim.onConflictDoNothing()
      : claim.onConflictDoUpdate({
          set: { clientId: minted },
          setWhere: eq(builtInClient.clientId, held.clientId),
          target: builtInClient.issuer,
        })
  )
    .returning()
    .get();
  if (won !== undefined) {
    return won.clientId;
  }
  await auth.helpers.deleteClient(minted);
  const winner = await db
    .select()
    .from(builtInClient)
    .where(eq(builtInClient.issuer, issuer))
    .get();
  if (winner === undefined) {
    throw new Error("the built-in agent's client was registered and then lost");
  }
  return winner.clientId;
};

const authorizeRequest = (auth: ConnectorAuth, query: Record<string, string>): Request => {
  const url = new URL(CONSENT_PATH, auth.origin);
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }
  return new Request(url);
};

// the account's grant, made anew: any earlier grant of this client for the account is revoked as
// this one is completed (`completeAuthorization`'s `revokeExistingGrants`), so an account holds one
export const grantBuiltInAgent = async (
  auth: ConnectorAuth,
  env: Env,
  grant: { readonly accountId: string; readonly endpoint: TokenEndpoint },
): Promise<BuiltInGrant> => {
  const clientId = await builtInClientId(env, auth);
  const redirectUri = redirectUriOf(auth.origin);
  const { challenge, verifier } = await pkcePair();
  const state = hexFromBytes(crypto.getRandomValues(new Uint8Array(16)));
  const authRequest = await auth.helpers.parseAuthRequest(
    authorizeRequest(auth, {
      client_id: clientId,
      code_challenge: challenge,
      code_challenge_method: "S256",
      redirect_uri: redirectUri,
      resource: auth.resource,
      response_type: "code",
      scope: SCOPE,
      state,
    }),
  );
  const { redirectTo } = await auth.helpers.completeAuthorization({
    metadata: { kind: "agent" } satisfies GrantMetadata,
    props: { accountId: grant.accountId, clientName: BUILT_IN_CLIENT_NAME },
    request: authRequest,
    scope: [SCOPE],
    userId: grant.accountId,
  });
  const answered = new URL(redirectTo);
  const code = answered.searchParams.get("code");
  if (code === null || answered.searchParams.get("state") !== state) {
    throw new Error("the built-in agent's authorization answered no code for its request");
  }
  const tokenEndpoint = `${auth.origin}${TOKEN_PATH}`;
  const response = await grant.endpoint.fetch(
    new Request(tokenEndpoint, {
      body: new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        resource: auth.resource,
      }),
      method: "POST",
    }),
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`the token endpoint answered the built-in agent's code ${response.status}`);
  }
  const tokens = tokenAnswerSchema.parse(await response.json());
  const minted = await auth.helpers.unwrapToken(tokens.access_token);
  if (minted === null) {
    throw new Error("the built-in agent's access token names no grant");
  }
  return {
    accessToken: tokens.access_token,
    clientId,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    grantId: minted.grantId,
    refreshToken: tokens.refresh_token,
    resource: auth.resource,
    scope: SCOPE,
    tokenEndpoint,
  };
};
