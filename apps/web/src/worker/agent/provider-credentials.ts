// ---------------------------------------------------------------------------
// The user's provider credentials — sealed, in their own Durable Object,
// never in the container.
//
// pi would keep this in its own `auth.json`, plaintext behind file permissions,
// and read it directly during an OAuth refresh — which is why there is no
// cipher seam inside pi to inject one at. That is not a multi-tenant answer:
// the credential would sit on a filesystem the user's own agent runs `bash`
// against, and one that is wiped every ten minutes anyway.
//
// So the WORKER owns the OAuth round-trip (./provider-oauth), the refresh token
// is sealed at rest here (./agent-crypto), and the container is handed a
// placeholder. Per request, the sandbox's outbound interception mints a
// short-lived access token from the refresh token and puts it on the wire
// (./egress). pi keeps working because pi never needed to OWN the credential —
// it needs a key-shaped string and a base URL, and it gets both.
//
// ONE THING IS STILL IN THE CONTAINER and it is worth naming rather than
// burying: the report bearer. The interceptor has to know whose credential to
// mint, so the container holds a token that entitles it to spend this user's
// provider quota. It cannot read the credential, exfiltrate it, or use it after
// the boot expires — but a model with a shell can make provider calls with it.
// That is a spend bound, not an isolation one.
// ---------------------------------------------------------------------------

import { openCredential, sealCredential } from "./agent-crypto";
import {
  providerEntry,
  providerOAuthApp,
  providerOAuthSecret,
  type ProviderEntry,
} from "./provider-catalog";
import type { DeletableDurableKv } from "../store/durable-kv";

/** Refresh this many milliseconds before the access token actually expires, so
 * a turn never starts on a credential that dies mid-stream. */
const REFRESH_MARGIN_MS = 60_000;

/** What a provider that returns no expiry is assumed to grant. Short, because
 * guessing long means a dead token used for hours. */
const DEFAULT_ACCESS_TTL_MS = 30 * 60_000;

/** The sealed record, as it round-trips through storage. */
type StoredCredential = {
  readonly refreshToken: string;
  readonly accessToken: string | null;
  readonly accessExpiresAt: number;
};

/** A pending authorization, held between `start` and the callback. */
export type PendingAuthorization = {
  readonly provider: string;
  readonly nonce: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly createdAt: number;
};

/** The selection the agent runs on. */
export type ProviderSelection = { readonly provider: string; readonly modelId: string };

export type CredentialStoreDeps = {
  readonly kv: DeletableDurableKv;
  readonly userId: string;
  /** The deployment secret both derived keys come from. */
  readonly secret: string;
  readonly env: Env;
  /** Injected so a test drives the real refresh path without a provider. */
  readonly fetch: typeof fetch;
};

const SELECTION_KEY = "agent/provider-selection";
const PENDING_KEY = "agent/provider-pending";
const credentialKey = (provider: string): string => `agent/provider-credential/${provider}`;

export type MintResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly error: string };

export class ProviderCredentials {
  private readonly kv: DeletableDurableKv;
  private readonly userId: string;
  private readonly secret: string;
  private readonly env: Env;
  private readonly fetchImpl: typeof fetch;

  /** Serializes the read-seal-write cycles. The Durable Object is
   * single-threaded but these span awaits, and two connects racing would
   * otherwise interleave a read with the other's write. */
  private tail: Promise<void> = Promise.resolve();

  constructor(deps: CredentialStoreDeps) {
    this.kv = deps.kv;
    this.userId = deps.userId;
    this.secret = deps.secret;
    this.env = deps.env;
    this.fetchImpl = deps.fetch;
  }

  // ---- selection ------------------------------------------------------------

  selection(): ProviderSelection | null {
    const stored = this.kv.get(SELECTION_KEY);
    if (typeof stored !== "object" || stored === null) return null;
    const record: Record<string, unknown> = { ...stored };
    const provider = record["provider"];
    const modelId = record["modelId"];
    if (typeof provider !== "string" || typeof modelId !== "string") return null;
    return { provider, modelId };
  }

  setSelection(selection: ProviderSelection): void {
    this.kv.put(SELECTION_KEY, selection);
  }

  // ---- connection state -----------------------------------------------------

  /** Whether this user has a credential for `provider` right now. Sync, because
   * every Settings snapshot asks and none of them needs the plaintext. */
  connected(provider: string): boolean {
    const entry = providerEntry(provider);
    if (entry === null) return false;
    // A provider with nothing to connect to is always connected: `sandbox` has
    // no account, and reporting it as disconnected would put a dead "Connect"
    // button in Settings.
    if (!entry.requiresAuth) return true;
    return typeof this.kv.get(credentialKey(provider)) === "string";
  }

  /** Drop `provider`'s credential. */
  disconnect(provider: string): void {
    this.kv.delete(credentialKey(provider));
  }

  // ---- the OAuth round-trip -------------------------------------------------

  /** Park the PKCE verifier for an authorization about to be started. One at a
   * time: a second `start` replaces the first, because a user who clicked
   * Connect twice meant the second one. */
  putPending(pending: PendingAuthorization): void {
    this.kv.put(PENDING_KEY, pending);
  }

  /** Take the parked authorization matching `nonce`, or null. Consumed on
   * read, so a replayed callback finds nothing. */
  takePending(nonce: string): PendingAuthorization | null {
    const stored = this.kv.get(PENDING_KEY);
    if (typeof stored !== "object" || stored === null) return null;
    const record: Record<string, unknown> = { ...stored };
    const provider = record["provider"];
    const storedNonce = record["nonce"];
    const verifier = record["verifier"];
    const redirectUri = record["redirectUri"];
    const createdAt = record["createdAt"];
    if (
      typeof provider !== "string" ||
      typeof storedNonce !== "string" ||
      typeof verifier !== "string" ||
      typeof redirectUri !== "string" ||
      typeof createdAt !== "number" ||
      storedNonce !== nonce
    ) {
      return null;
    }
    this.kv.delete(PENDING_KEY);
    return { provider, nonce: storedNonce, verifier, redirectUri, createdAt };
  }

  /**
   * Exchange an authorization code and seal what comes back.
   *
   * A provider that returns no refresh token is REFUSED rather than stored: an
   * access token alone would work until it expired and then present as a
   * mysteriously broken account, and there is no interactive session left to
   * re-prompt in.
   */
  async completeAuthorization(
    pending: PendingAuthorization,
    code: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = providerEntry(pending.provider);
    const app = providerOAuthApp(this.env, pending.provider);
    if (entry === null || app === null) {
      return { ok: false, error: "This deployment no longer offers that provider." };
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: app.clientId,
      code_verifier: pending.verifier,
    });
    const secret = providerOAuthSecret(this.env, pending.provider);
    if (secret !== null) body.set("client_secret", secret);

    const token = await this.postToken(app.tokenUrl, body);
    if (!token.ok) return { ok: false, error: token.error };
    if (token.refreshToken === null) {
      return {
        ok: false,
        error: "The provider returned no refresh token, so the connection could not be kept.",
      };
    }
    await this.write(pending.provider, {
      refreshToken: token.refreshToken,
      accessToken: token.accessToken,
      accessExpiresAt: token.expiresAt,
    });
    return { ok: true };
  }

  // ---- minting --------------------------------------------------------------

  /**
   * A live access token for `entry`, refreshing when the cached one is spent.
   *
   * This is what the egress interceptor calls, on the request path, so the
   * cached token is reused until it is nearly expired — refreshing per request
   * would put a token round-trip in front of every model call.
   */
  async mintAccessToken(entry: ProviderEntry): Promise<MintResult> {
    if (!entry.requiresAuth) return { ok: true, token: "sandbox" };
    const stored = await this.read(entry.id);
    if (stored === null) {
      return { ok: false, error: `no ${entry.label} credential for this account` };
    }
    if (stored.accessToken !== null && stored.accessExpiresAt - REFRESH_MARGIN_MS > Date.now()) {
      return { ok: true, token: stored.accessToken };
    }
    const app = providerOAuthApp(this.env, entry.id);
    if (app === null) return { ok: false, error: `${entry.label} is not configured here` };

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
      client_id: app.clientId,
    });
    const secret = providerOAuthSecret(this.env, entry.id);
    if (secret !== null) body.set("client_secret", secret);

    const refreshed = await this.postToken(app.tokenUrl, body);
    if (!refreshed.ok) return { ok: false, error: refreshed.error };
    if (refreshed.accessToken === null) {
      return { ok: false, error: `${entry.label} returned no access token` };
    }
    await this.write(entry.id, {
      // A provider that rotates its refresh token sends the new one back; one
      // that does not keeps the old, and dropping it would end the connection
      // at the next refresh.
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
      accessToken: refreshed.accessToken,
      accessExpiresAt: refreshed.expiresAt,
    });
    return { ok: true, token: refreshed.accessToken };
  }

  // ---- internals ------------------------------------------------------------

  private async read(provider: string): Promise<StoredCredential | null> {
    const sealed = this.kv.get(credentialKey(provider));
    if (typeof sealed !== "string") return null;
    const plaintext = await openCredential(this.secret, this.userId, sealed);
    if (plaintext === null) {
      // Sealed by a key this deployment no longer derives — a rotated secret,
      // or a blob from another object. Unreadable is indistinguishable from
      // absent to every caller, and leaving it would keep Settings claiming a
      // connection nothing can use.
      this.kv.delete(credentialKey(provider));
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const record: Record<string, unknown> = { ...parsed };
    const refreshToken = record["refreshToken"];
    const accessToken = record["accessToken"];
    const accessExpiresAt = record["accessExpiresAt"];
    if (typeof refreshToken !== "string" || refreshToken === "") return null;
    return {
      refreshToken,
      accessToken: typeof accessToken === "string" && accessToken !== "" ? accessToken : null,
      accessExpiresAt: typeof accessExpiresAt === "number" ? accessExpiresAt : 0,
    };
  }

  private write(provider: string, credential: StoredCredential): Promise<void> {
    const seal = async (): Promise<void> => {
      const sealed = await sealCredential(this.secret, this.userId, JSON.stringify(credential));
      this.kv.put(credentialKey(provider), sealed);
    };
    const run = this.tail.then(seal);
    // Keep the chain alive regardless of this write's outcome (the caller still
    // receives the rejection through `run`).
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** One token-endpoint call, with every failure shaped as a VALUE — a provider
   * that is down, rate-limited, or has revoked the grant is a sentence the user
   * reads in Settings, not an exception from inside an interceptor. */
  private async postToken(
    tokenUrl: string,
    body: URLSearchParams,
  ): Promise<
    | {
        ok: true;
        accessToken: string | null;
        refreshToken: string | null;
        expiresAt: number;
      }
    | { ok: false; error: string }
  > {
    let response: Response;
    try {
      response = await this.fetchImpl(tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
      });
    } catch {
      return { ok: false, error: "could not reach the provider's token endpoint" };
    }
    if (!response.ok) {
      return { ok: false, error: `the provider refused the token request (${response.status})` };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { ok: false, error: "the provider's token response was not JSON" };
    }
    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, error: "the provider's token response was not an object" };
    }
    const record: Record<string, unknown> = { ...parsed };
    const accessToken = record["access_token"];
    const refreshToken = record["refresh_token"];
    const expiresIn = record["expires_in"];
    return {
      ok: true,
      accessToken: typeof accessToken === "string" && accessToken !== "" ? accessToken : null,
      refreshToken: typeof refreshToken === "string" && refreshToken !== "" ? refreshToken : null,
      expiresAt:
        Date.now() + (typeof expiresIn === "number" ? expiresIn * 1000 : DEFAULT_ACCESS_TTL_MS),
    };
  }
}
