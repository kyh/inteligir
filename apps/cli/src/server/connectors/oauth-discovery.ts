// the mcp authorization spec's discovery: the server's protected resource metadata (rfc 9728)
// names its authorization server, whose metadata (rfc 8414, or openid discovery) names the
// endpoints, and a client is registered dynamically (rfc 7591) when the row names none. every url
// read or handed on must be https or loopback: a remote party chose them, and one plain-http hop
// lets anyone on the path swap the page the user signs in on.

import { z } from "zod";

import { isLocalHostname } from "../loopback-origin";
import type { StoredDiscoveredServer } from "./connectors-store";

const DISCOVERY_REQUEST_TIMEOUT_MS = 10 * 1000;
const CLIENT_NAME = "inteligir";

const protectedResourceMetadataSchema = z.looseObject({
  authorization_servers: z.array(z.string().min(1)).min(1),
  resource: z.string().min(1),
  scopes_supported: z.array(z.string().min(1)).optional(),
});

const authorizationServerMetadataSchema = z.looseObject({
  authorization_endpoint: z.string().min(1),
  code_challenge_methods_supported: z.array(z.string()).optional(),
  issuer: z.string().min(1),
  registration_endpoint: z.string().min(1).optional(),
  token_endpoint: z.string().min(1),
});

const clientRegistrationSchema = z.looseObject({
  client_id: z.string().min(1),
  token_endpoint_auth_method: z.string().optional(),
});

const CHALLENGE_PARAMS = {
  resourceMetadata: /(?:^|[\s,])resource_metadata=(?:"(?<quoted>[^"]*)"|(?<bare>[^\s,]+))/u,
  scope: /(?:^|[\s,])scope=(?:"(?<quoted>[^"]*)"|(?<bare>[^\s,]+))/u,
} as const;

export interface Refusal {
  ok: false;
  detail: string;
}

export type OauthDiscovery =
  | { ok: true; clientId: string; discovered: StoredDiscoveredServer }
  | Refusal;

export interface DiscoverOauthServerArgs {
  url: string;
  // the row's own; absent, one is registered for `redirectUri`
  clientId: string | undefined;
  // the row's own; empty, the registration asks for the server's
  scopes: readonly string[];
  redirectUri: string;
  fetchImpl: typeof fetch;
}

interface Challenge {
  resourceMetadata: string | null;
  scopes: string[] | null;
}

const refused = (detail: string): Refusal => ({ detail, ok: false });

const secureUrl = (raw: string): URL | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const secure =
    url.protocol === "https:" || (url.protocol === "http:" && isLocalHostname(url.hostname));
  return secure ? url : null;
};

const withoutTrailingSlashes = (path: string): string => path.replace(/\/+$/u, "");

const asDirectory = (path: string): string => `${withoutTrailingSlashes(path)}/`;

const discardBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // an errored stream has nothing left to release.
  }
};

// a 401's bearer challenge, or none. an unauthenticated GET opens no mcp session, and a server
// that needs no token may answer with an event stream, so the body is never read.
const probeChallenge = async (
  resource: URL,
  fetchImpl: typeof fetch,
): Promise<Challenge | null> => {
  let response: Response;
  try {
    response = await fetchImpl(resource, {
      headers: { accept: "application/json, text/event-stream" },
      signal: AbortSignal.timeout(DISCOVERY_REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  await discardBody(response);
  const header = response.status === 401 ? response.headers.get("www-authenticate") : null;
  if (header === null || !/^\s*bearer\s/iu.test(header)) {
    return { resourceMetadata: null, scopes: null };
  }
  const param = (pattern: RegExp): string | null => {
    const groups = pattern.exec(header)?.groups;
    return groups?.quoted ?? groups?.bare ?? null;
  };
  const scope = param(CHALLENGE_PARAMS.scope);
  return {
    resourceMetadata: param(CHALLENGE_PARAMS.resourceMetadata),
    scopes: scope === null ? null : scope.split(/\s+/u).filter((entry) => entry.length > 0),
  };
};

// rfc 9728 §3.1: inserted before the path first, then at the root.
const resourceMetadataUrls = (resource: URL): URL[] => {
  const root = new URL("/.well-known/oauth-protected-resource", resource.origin);
  const path = withoutTrailingSlashes(resource.pathname);
  if (path === "") {
    return [root];
  }
  const inserted = new URL(`/.well-known/oauth-protected-resource${path}`, resource.origin);
  inserted.search = resource.search;
  return [inserted, root];
};

// the order the mcp spec fixes over rfc 8414 and openid discovery.
const authorizationServerMetadataUrls = (issuer: URL): URL[] => {
  const at = (pathname: string): URL => new URL(pathname, issuer.origin);
  const path = withoutTrailingSlashes(issuer.pathname);
  return path === ""
    ? [at("/.well-known/oauth-authorization-server"), at("/.well-known/openid-configuration")]
    : [
        at(`/.well-known/oauth-authorization-server${path}`),
        at(`/.well-known/openid-configuration${path}`),
        at(`${path}/.well-known/openid-configuration`),
      ];
};

// rfc 9728 §3.3 asks for the identical url, but a server's metadata commonly names its origin or
// a parent path it guards whole; a same-origin parent is accepted, never a sibling or another host.
const resourceCovers = (named: string, resource: URL): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(named);
  } catch {
    return false;
  }
  return (
    parsed.origin === resource.origin &&
    asDirectory(resource.pathname).startsWith(asDirectory(parsed.pathname))
  );
};

// rfc 8414 §3.3, tolerating the one trailing slash a url serializer adds.
const sameIssuer = (published: string, named: string): boolean =>
  withoutTrailingSlashes(published) === withoutTrailingSlashes(named);

// a missing, unparseable or mismatched document is the next candidate's turn.
const firstDocument = async <T>(
  urls: readonly URL[],
  schema: z.ZodType<T>,
  accept: (document: T) => boolean,
  fetchImpl: typeof fetch,
): Promise<T | null> => {
  for (const url of urls) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(DISCOVERY_REQUEST_TIMEOUT_MS),
      });
    } catch {
      continue;
    }
    if (!response.ok) {
      await discardBody(response);
      continue;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      continue;
    }
    const parsed = schema.safeParse(body);
    if (parsed.success && accept(parsed.data)) {
      return parsed.data;
    }
  }
  return null;
};

// rfc 7591 §2, the fields this app sends.
interface ClientMetadata {
  application_type: "native";
  client_name: string;
  grant_types: string[];
  redirect_uris: string[];
  response_types: string[];
  scope?: string;
  token_endpoint_auth_method: "none";
}

// a public client: the app holds no secret an installed copy could keep.
const registerClient = async (
  endpoint: URL,
  redirectUri: string,
  scopes: readonly string[],
  fetchImpl: typeof fetch,
): Promise<{ ok: true; clientId: string } | Refusal> => {
  const metadata: ClientMetadata = {
    // openid registration defaults to a web client, which may not redirect to a loopback http uri
    application_type: "native",
    client_name: CLIENT_NAME,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [redirectUri],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  if (scopes.length > 0) {
    metadata.scope = scopes.join(" ");
  }
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      body: JSON.stringify(metadata),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(DISCOVERY_REQUEST_TIMEOUT_MS),
    });
  } catch {
    return refused("The authorization server's registration endpoint did not answer.");
  }
  if (!response.ok) {
    await discardBody(response);
    return refused(
      `The authorization server refused to register this app (HTTP ${String(response.status)}).`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return refused("The authorization server's registration answer was not JSON.");
  }
  const registration = clientRegistrationSchema.safeParse(body);
  if (!registration.success) {
    return refused("The authorization server's registration answer had no client_id.");
  }
  const method = registration.data.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    return refused(
      `The authorization server registered this app for "${method}", but it holds no client secret.`,
    );
  }
  return { clientId: registration.data.client_id, ok: true };
};

// the challenge's scope and the metadata the resource publishes for this url.
const findProtectedResource = async (
  resource: URL,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; scopes: string[]; issuerName: string } | Refusal> => {
  const challenge = await probeChallenge(resource, fetchImpl);
  if (challenge === null) {
    return refused(`The MCP server at ${resource.host} did not answer.`);
  }
  const challenged =
    challenge.resourceMetadata === null ? null : secureUrl(challenge.resourceMetadata);
  const metadata = await firstDocument(
    challenged === null ? resourceMetadataUrls(resource) : [challenged],
    protectedResourceMetadataSchema,
    (document) => resourceCovers(document.resource, resource),
    fetchImpl,
  );
  const [issuerName] = metadata?.authorization_servers ?? [];
  if (metadata === null || issuerName === undefined) {
    return refused(
      `The MCP server at ${resource.host} publishes no OAuth metadata for this URL; name its endpoints and client id instead.`,
    );
  }
  return {
    issuerName,
    ok: true,
    scopes: challenge.scopes ?? metadata.scopes_supported ?? [],
  };
};

interface AuthorizationServer {
  host: string;
  authorizationEndpoint: URL;
  tokenEndpoint: URL;
  registrationEndpoint: URL | null;
}

const findAuthorizationServer = async (
  issuerName: string,
  fetchImpl: typeof fetch,
): Promise<({ ok: true } & AuthorizationServer) | Refusal> => {
  const issuer = secureUrl(issuerName);
  if (issuer === null) {
    return refused("The MCP server names no authorization server reachable over https.");
  }
  const metadata = await firstDocument(
    authorizationServerMetadataUrls(issuer),
    authorizationServerMetadataSchema,
    (document) => sameIssuer(document.issuer, issuerName),
    fetchImpl,
  );
  if (metadata === null) {
    return refused(`The authorization server at ${issuer.host} publishes no metadata.`);
  }
  // the mcp spec's rule: no advertised S256 is no pkce, and an authorize without it is refused.
  if (metadata.code_challenge_methods_supported?.includes("S256") !== true) {
    return refused(
      `The authorization server at ${issuer.host} does not advertise PKCE (S256), which this app requires.`,
    );
  }
  const authorizationEndpoint = secureUrl(metadata.authorization_endpoint);
  const tokenEndpoint = secureUrl(metadata.token_endpoint);
  if (authorizationEndpoint === null || tokenEndpoint === null) {
    return refused(
      `The authorization server at ${issuer.host} names endpoints that are not https.`,
    );
  }
  const registrationEndpoint =
    metadata.registration_endpoint === undefined ? null : secureUrl(metadata.registration_endpoint);
  return {
    authorizationEndpoint,
    host: issuer.host,
    ok: true,
    registrationEndpoint,
    tokenEndpoint,
  };
};

export const discoverOauthServer = async (
  args: DiscoverOauthServerArgs,
): Promise<OauthDiscovery> => {
  const { fetchImpl } = args;
  const resource = secureUrl(args.url);
  if (resource === null) {
    return refused(
      "Discovery reads only https:// servers (or this machine's own); name this server's endpoints and client id instead.",
    );
  }
  const protectedResource = await findProtectedResource(resource, fetchImpl);
  if (!protectedResource.ok) {
    return protectedResource;
  }
  const server = await findAuthorizationServer(protectedResource.issuerName, fetchImpl);
  if (!server.ok) {
    return server;
  }
  const discovered: StoredDiscoveredServer = {
    authorizationEndpoint: server.authorizationEndpoint.href,
    scopes: protectedResource.scopes,
    tokenEndpoint: server.tokenEndpoint.href,
  };
  if (args.clientId !== undefined) {
    return { clientId: args.clientId, discovered, ok: true };
  }
  if (server.registrationEndpoint === null) {
    return refused(
      `The authorization server at ${server.host} registers no clients on request; name a client id registered with it.`,
    );
  }
  const registered = await registerClient(
    server.registrationEndpoint,
    args.redirectUri,
    args.scopes.length > 0 ? args.scopes : discovered.scopes,
    fetchImpl,
  );
  if (!registered.ok) {
    return registered;
  }
  discovered.registration = { clientId: registered.clientId, redirectUri: args.redirectUri };
  return { clientId: registered.clientId, discovered, ok: true };
};
