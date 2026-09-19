// state consumed before the exchange, pkce s256 so an intercepted loopback redirect holds a
// code nobody else can spend, and a `disposed` guard so a callback in flight during shutdown
// exchanges nothing.

import { createApprovalSlot } from "@repo/api/cloud/approval-slot";
import { z } from "zod";

import type { ConnectorsStore, StoredOauthTokens } from "./connectors-store";
import { ConnectorConflictError } from "./connectors-service";
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
  | { kind: "refused"; detail: string };

interface PendingAuthorize {
  name: string;
  verifier: string;
  redirectUri: string;
}

export interface ConnectorOauthFlow {
  begin: (name: string, redirectUri: string) => Promise<string>;
  complete: (args: { code: string; state: string }) => Promise<OauthCompletion>;
  freshAccessToken: (name: string) => Promise<string | null>;
  disconnect: (name: string) => void;
  dispose: () => void;
}

type OauthRow = Extract<
  ReturnType<ConnectorsStore["read"]>[number]["transport"],
  { kind: "oauth" }
>;

export const createConnectorOauthFlow = (
  store: ConnectorsStore,
  fetchImpl: typeof fetch = fetch,
): ConnectorOauthFlow => {
  const pending = createApprovalSlot<PendingAuthorize>({ ttlMs: PENDING_TTL_MS });
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

  const patchRow = (name: string, patch: (transport: OauthRow) => void): void => {
    const servers = store.read();
    const row = servers.find((candidate) => candidate.name === name);
    if (row === undefined || row.transport.kind !== "oauth") {
      return;
    }
    patch(row.transport);
    store.write(servers);
  };

  const exchangeAtTokenEndpoint = async (
    transport: OauthRow,
    body: URLSearchParams,
  ): Promise<{ ok: true; tokens: StoredOauthTokens } | { ok: false; detail: string }> => {
    let response: Response;
    try {
      response = await fetchImpl(transport.tokenEndpoint, {
        body: body.toString(),
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { detail: "The provider's token endpoint did not answer.", ok: false };
    }
    if (!response.ok) {
      // the error body may carry anything; the status is the one fact safe to repeat.
      return {
        detail: `The provider refused the token request (HTTP ${String(response.status)}).`,
        ok: false,
      };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { detail: "The provider's token answer was not JSON.", ok: false };
    }
    const verdict = tokenResponseSchema.safeParse(parsed);
    if (!verdict.success) {
      return { detail: "The provider's token answer had no access_token.", ok: false };
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

  return {
    async begin(name, redirectUri): Promise<string> {
      if (disposed) {
        throw new ConnectorConflictError("not-found", "This app is shutting down");
      }
      const transport = requireOauthRow(name);
      const verifier = generatePkceVerifier();
      const challenge = await pkceChallengeS256(verifier);
      const state = pending.arm({ name, redirectUri, verifier });
      const url = new URL(transport.authorizationEndpoint);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", transport.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      if (transport.scopes.length > 0) {
        url.searchParams.set("scope", transport.scopes.join(" "));
      }
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
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
      const transport = requireOauthRow(claimed.name);
      const exchange = await exchangeAtTokenEndpoint(
        transport,
        new URLSearchParams({
          client_id: transport.clientId,
          code,
          code_verifier: claimed.verifier,
          grant_type: "authorization_code",
          redirect_uri: claimed.redirectUri,
        }),
      );
      if (!exchange.ok) {
        return { detail: exchange.detail, kind: "refused" };
      }
      if (disposed) {
        // shutdown raced the exchange: store nothing after teardown.
        return { kind: "no-pending" };
      }
      patchRow(claimed.name, (row) => {
        row.tokens = exchange.tokens;
        delete row.needsReauth;
      });
      return { kind: "connected", name: claimed.name };
    },

    disconnect(name): void {
      requireOauthRow(name);
      patchRow(name, (row) => {
        delete row.tokens;
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
      const fresh =
        tokens.expiresAt === null || tokens.expiresAt * 1000 - EXPIRY_SKEW_MS > Date.now();
      if (fresh) {
        return tokens.accessToken;
      }
      if (tokens.refreshToken === undefined) {
        patchRow(name, (row) => {
          row.needsReauth = true;
        });
        return null;
      }
      const exchange = await exchangeAtTokenEndpoint(
        transport,
        new URLSearchParams({
          client_id: transport.clientId,
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
        }),
      );
      if (!exchange.ok) {
        patchRow(name, (row) => {
          row.needsReauth = true;
        });
        return null;
      }
      const next = exchange.tokens;
      // a refresh answer without a rotated refresh_token keeps the old one (rfc 6749 §6).
      if (next.refreshToken === undefined && tokens.refreshToken !== undefined) {
        next.refreshToken = tokens.refreshToken;
      }
      patchRow(name, (row) => {
        row.tokens = next;
        delete row.needsReauth;
      });
      return next.accessToken;
    },
  };
};
