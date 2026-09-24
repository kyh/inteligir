// state consumed before the exchange, pkce s256 so an intercepted loopback redirect holds a
// code nobody else can spend, and a `disposed` guard so a callback in flight during shutdown
// exchanges nothing.

import { z } from "zod";

import { createApprovalSlot } from "./approval-slot";
import { namedOauthServerOf, oauthServerOf } from "./connectors-store";
import type {
  ConnectorsStore,
  OauthServer,
  StoredConnector,
  StoredDiscoveredServer,
  StoredOauthTokens,
  StoredOauthTransport,
} from "./connectors-store";
import { ConnectorConflictError } from "./connectors-service";
import { discoverOauthServer } from "./oauth-discovery";
import { generatePkceVerifier, pkceChallengeS256 } from "./pkce";

const PENDING_TTL_MS = 10 * 60 * 1000;
// refreshed this close to expiry: a token that dies mid-turn is worse than one refresh early.
const EXPIRY_SKEW_MS = 60 * 1000;
const TOKEN_REQUEST_TIMEOUT_MS = 15 * 1000;

const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
});

export type OauthCompletion =
  | { kind: "connected"; name: string }
  | { kind: "no-pending" }
  | { kind: "state-mismatch" }
  | { kind: "expired" }
  // the row was removed, or is no longer oauth, between the authorize and its callback.
  | { kind: "removed" }
  | { kind: "refused"; detail: string };

// what a begin resolved rides the pending slot, so the code is spent at the token endpoint of the
// authorization the user approved, and the discovery behind it lands with the grant.
interface AuthorizeTarget {
  server: OauthServer;
  scopes: readonly string[];
  // null when the row names its own server
  discovered: StoredDiscoveredServer | null;
}

interface PendingAuthorize extends AuthorizeTarget {
  name: string;
  // a remove and re-add under the name meanwhile is another server's row.
  url: string;
  verifier: string;
  redirectUri: string;
}

type OauthBegin = { ok: true; url: string } | { ok: false; detail: string };

export interface ConnectorOauthFlow {
  begin: (name: string, redirectUri: string) => Promise<OauthBegin>;
  complete: (args: { code: string; state: string }) => Promise<OauthCompletion>;
  freshAccessToken: (name: string) => Promise<string | null>;
  disconnect: (name: string) => void;
  dispose: () => void;
}

type OauthRow = StoredOauthTransport;

// only a 400 or 401 is the token endpoint's verdict on the grant (rfc 6749 §5.2). no answer, a
// 5xx, or a captive portal's page says nothing about it, and must not cost the user a re-consent.
type TokenExchange =
  | { ok: true; tokens: StoredOauthTokens }
  | { ok: false; kind: "refused" | "unreachable"; detail: string };

const GRANT_VERDICT_STATUSES: ReadonlySet<number> = new Set([400, 401]);

interface RefreshInFlight {
  spent: string;
  answer: Promise<string | null>;
}

const isFresh = (tokens: StoredOauthTokens): boolean =>
  tokens.expiresAt === null || tokens.expiresAt * 1000 - EXPIRY_SKEW_MS > Date.now();

// the mcp authorization spec's canonical server uri (rfc 8707 §2): the url parser lowercases the
// scheme and host, and the fragment and a trailing slash go, so `https://mcp.example.com/` and
// the bare origin name one audience.
const canonicalResourceUri = (url: string): string => {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
};

const oauthTransportIn = (servers: StoredConnector[], name: string): OauthRow | null => {
  const row = servers.find((candidate) => candidate.name === name);
  return row !== undefined && row.transport.kind === "oauth" ? row.transport : null;
};

const discoveredTarget = (
  transport: OauthRow,
  discovered: StoredDiscoveredServer,
  clientId: string,
): AuthorizeTarget => ({
  discovered,
  scopes: transport.scopes.length > 0 ? transport.scopes : discovered.scopes,
  server: {
    authorizationEndpoint: discovered.authorizationEndpoint,
    clientId,
    tokenEndpoint: discovered.tokenEndpoint,
  },
});

// a stored discovery is reused, unless its client was registered for another redirect uri: a
// provider may match a loopback redirect by its exact string, port and host spelling included.
const reusableTarget = (transport: OauthRow, redirectUri: string): AuthorizeTarget | null => {
  const { discovered } = transport;
  if (discovered === undefined) {
    return null;
  }
  if (transport.clientId !== undefined) {
    return discoveredTarget(transport, discovered, transport.clientId);
  }
  return discovered.registration?.redirectUri === redirectUri
    ? discoveredTarget(transport, discovered, discovered.registration.clientId)
    : null;
};

export const createConnectorOauthFlow = (
  store: ConnectorsStore,
  fetchImpl: typeof fetch = fetch,
): ConnectorOauthFlow => {
  const pending = createApprovalSlot<PendingAuthorize>({ ttlMs: PENDING_TTL_MS });
  // a rotating provider honours a refresh token once: a second concurrent spend is refused, and
  // its needs-reauth would land over the first one's rotated tokens.
  const refreshing = new Map<string, RefreshInFlight>();
  let disposed = false;

  const requireOauthRow = (name: string): OauthRow => {
    const row = store.read().find((candidate) => candidate.name === name);
    if (row === undefined) {
      throw new ConnectorConflictError("not-found", `No connector named "${name}" is configured`);
    }
    if (row.transport.kind !== "oauth") {
      throw new ConnectorConflictError(
        "not-found",
        `"${name}" is not an OAuth connector — only OAuth rows authorize`,
      );
    }
    return row.transport;
  };

  // `when` is checked against the same read the patch writes, so a precondition cannot go stale
  // between the check and the write.
  const patchRow = (
    name: string,
    patch: (transport: OauthRow) => void,
    when: (transport: OauthRow) => boolean = () => true,
  ): boolean => {
    const servers = store.read();
    const transport = oauthTransportIn(servers, name);
    if (transport === null || !when(transport)) {
      return false;
    }
    patch(transport);
    store.write(servers);
    return true;
  };

  const resolveTarget = async (
    name: string,
    transport: OauthRow,
    redirectUri: string,
  ): Promise<{ ok: true; target: AuthorizeTarget } | { ok: false; detail: string }> => {
    const named = namedOauthServerOf(transport);
    if (named !== null) {
      return { ok: true, target: { discovered: null, scopes: transport.scopes, server: named } };
    }
    const reused = reusableTarget(transport, redirectUri);
    if (reused !== null) {
      return { ok: true, target: reused };
    }
    const discovery = await discoverOauthServer({
      clientId: transport.clientId,
      fetchImpl,
      redirectUri,
      scopes: transport.scopes,
      url: transport.url,
    });
    if (!discovery.ok) {
      return discovery;
    }
    // kept at once, so a Connect retried after a closed consent tab reuses the client rather than
    // registering another; while a grant rests on the discovery before it, a refresh still needs
    // that one, and this one lands with the grant it authorizes.
    patchRow(
      name,
      (row) => {
        row.discovered = discovery.discovered;
      },
      (row) => row.url === transport.url && row.tokens === undefined,
    );
    return {
      ok: true,
      target: discoveredTarget(transport, discovery.discovered, discovery.clientId),
    };
  };

  const exchangeAtTokenEndpoint = async (
    tokenEndpoint: string,
    body: URLSearchParams,
  ): Promise<TokenExchange> => {
    let response: Response;
    try {
      response = await fetchImpl(tokenEndpoint, {
        body: body.toString(),
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      });
    } catch {
      return {
        detail: "The provider's token endpoint did not answer.",
        kind: "unreachable",
        ok: false,
      };
    }
    if (!response.ok) {
      // the error body may carry anything; the status is the one fact safe to repeat.
      return {
        detail: `The provider refused the token request (HTTP ${String(response.status)}).`,
        kind: GRANT_VERDICT_STATUSES.has(response.status) ? "refused" : "unreachable",
        ok: false,
      };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return {
        detail: "The provider's token answer was not JSON.",
        kind: "unreachable",
        ok: false,
      };
    }
    const verdict = tokenResponseSchema.safeParse(parsed);
    if (!verdict.success) {
      return {
        detail: "The provider's token answer had no access_token.",
        kind: "unreachable",
        ok: false,
      };
    }
    const { access_token, refresh_token, expires_in } = verdict.data;
    const tokens: StoredOauthTokens = {
      accessToken: access_token,
      expiresAt:
        expires_in === undefined ? null : Math.floor((Date.now() + expires_in * 1000) / 1000),
    };
    if (refresh_token !== undefined) {
      tokens.refreshToken = refresh_token;
    }
    return { ok: true, tokens };
  };

  // every write is conditional on the row still holding the token this spent: a disconnect or a
  // re-authorize that landed meanwhile wins over the answer to an older grant.
  const refresh = async (
    name: string,
    transport: OauthRow,
    server: OauthServer,
    spent: string,
  ): Promise<string | null> => {
    const exchange = await exchangeAtTokenEndpoint(
      server.tokenEndpoint,
      new URLSearchParams({
        client_id: server.clientId,
        grant_type: "refresh_token",
        refresh_token: spent,
        resource: canonicalResourceUri(transport.url),
      }),
    );
    const holdsSpent = (row: OauthRow): boolean => row.tokens?.refreshToken === spent;
    if (!exchange.ok) {
      if (exchange.kind === "refused") {
        patchRow(
          name,
          (row) => {
            row.needsReauth = true;
          },
          holdsSpent,
        );
      }
      return null;
    }
    const next = exchange.tokens;
    // a refresh answer without a rotated refresh_token keeps the old one (rfc 6749 §6).
    next.refreshToken ??= spent;
    const landed = patchRow(
      name,
      (row) => {
        row.tokens = next;
        delete row.needsReauth;
      },
      holdsSpent,
    );
    return landed ? next.accessToken : null;
  };

  return {
    async begin(name, redirectUri): Promise<OauthBegin> {
      if (disposed) {
        throw new ConnectorConflictError("not-found", "This app is shutting down");
      }
      const transport = requireOauthRow(name);
      const resolved = await resolveTarget(name, transport, redirectUri);
      if (!resolved.ok) {
        return resolved;
      }
      const { target } = resolved;
      const verifier = generatePkceVerifier();
      const challenge = await pkceChallengeS256(verifier);
      const state = pending.arm({ ...target, name, redirectUri, url: transport.url, verifier });
      const url = new URL(target.server.authorizationEndpoint);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", target.server.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      if (target.scopes.length > 0) {
        url.searchParams.set("scope", target.scopes.join(" "));
      }
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("resource", canonicalResourceUri(transport.url));
      return { ok: true, url: url.toString() };
    },

    async complete({ code, state }): Promise<OauthCompletion> {
      if (disposed) {
        return { kind: "no-pending" };
      }
      const claim = pending.claim(state);
      if (claim.kind !== "claimed") {
        return { kind: claim.kind };
      }
      const claimed = claim.payload;
      const isClaimedRow = (row: OauthRow): boolean => row.url === claimed.url;
      const transport = oauthTransportIn(store.read(), claimed.name);
      if (transport === null || !isClaimedRow(transport)) {
        return { kind: "removed" };
      }
      const exchange = await exchangeAtTokenEndpoint(
        claimed.server.tokenEndpoint,
        new URLSearchParams({
          client_id: claimed.server.clientId,
          code,
          code_verifier: claimed.verifier,
          grant_type: "authorization_code",
          redirect_uri: claimed.redirectUri,
          resource: canonicalResourceUri(claimed.url),
        }),
      );
      if (!exchange.ok) {
        return { detail: exchange.detail, kind: "refused" };
      }
      if (disposed) {
        // shutdown raced the exchange: store nothing after teardown.
        return { kind: "no-pending" };
      }
      const landed = patchRow(
        claimed.name,
        (row) => {
          row.tokens = exchange.tokens;
          if (claimed.discovered === null) {
            delete row.discovered;
          } else {
            row.discovered = claimed.discovered;
          }
          delete row.needsReauth;
        },
        isClaimedRow,
      );
      return landed ? { kind: "connected", name: claimed.name } : { kind: "removed" };
    },

    // the discovery goes too, so the next authorize finds the server afresh: the way out when a
    // provider has forgotten the client it registered.
    disconnect(name): void {
      requireOauthRow(name);
      patchRow(name, (row) => {
        delete row.tokens;
        delete row.discovered;
        delete row.needsReauth;
      });
    },

    dispose(): void {
      disposed = true;
      pending.clear();
    },

    async freshAccessToken(name): Promise<string | null> {
      const transport = requireOauthRow(name);
      const { tokens } = transport;
      if (tokens === undefined) {
        return null;
      }
      if (isFresh(tokens)) {
        return tokens.accessToken;
      }
      const spent = tokens.refreshToken;
      const server = oauthServerOf(transport);
      if (spent === undefined || server === null) {
        patchRow(name, (row) => {
          row.needsReauth = true;
        });
        return null;
      }
      const inFlight = refreshing.get(name);
      if (inFlight !== undefined && inFlight.spent === spent) {
        return await inFlight.answer;
      }
      const started: RefreshInFlight = {
        answer: refresh(name, transport, server, spent),
        spent,
      };
      refreshing.set(name, started);
      try {
        return await started.answer;
      } finally {
        if (refreshing.get(name) === started) {
          refreshing.delete(name);
        }
      }
    },
  };
};
