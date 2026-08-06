// ---------------------------------------------------------------------------
// SyncAccount — the desktop's sign-in + server config, persisted under
// ~/.inteligir (never in the vault). Two versioned JsonStores:
//   - sync-config.json  { serverUrl }      — which deployment the account is on
//   - sync-auth.json    { token, email }   — the bearer session
//
// Auth is Better Auth email+password against the server's `/api/auth/*`. The
// server runs the bearer() plugin, so sign-in returns the session token in the
// `set-auth-token` response header; `onSuccess` captures it and we stash it,
// and every authenticated call sends `Authorization: Bearer <token>`. The
// Better Auth client is framework-agnostic and runs on node's global fetch —
// no react/expo wrapper here.
//
// The server URL is per-install configuration (a self-hoster points at their
// own Worker), which is why there is no default and every call refuses as a
// VALUE until one is set.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { type Static, Type } from "@sinclair/typebox";
import { createAuthClient } from "better-auth/client";

import { JsonStore, inteligirPath } from "@repo/storage/json-store";
import type { StoreAdapter } from "@repo/storage/json-store-core";
import { isRecord, toErrorMessage } from "@repo/bridge/wire-helpers";
import type { AccountCapabilities, AccountState, SyncSignInResult } from "@repo/bridge/sync";

// ---------------------------------------------------------------------------
// Store schemas — each versioned; a legacy/corrupt file resets to the default
// (no server, signed out), never data loss (no note content lives here).
// ---------------------------------------------------------------------------

const CONFIG_VERSION = 2;
const AUTH_VERSION = 1;

const SyncConfigSchema = Type.Object(
  { version: Type.Literal(CONFIG_VERSION), serverUrl: Type.String() },
  { additionalProperties: false },
);

const SyncAuthSchema = Type.Object(
  {
    version: Type.Literal(AUTH_VERSION),
    token: Type.Union([Type.String(), Type.Null()]),
    email: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

// Stored shapes carry the version field; getters project it away. Keeping the
// in-memory type equal to the schema's Static lets JsonStore use its identity
// decode/encode (no contravariant decode callback), and version stays internal.
type StoredConfig = Static<typeof SyncConfigSchema>;
type StoredAuth = Static<typeof SyncAuthSchema>;

const DEFAULT_CONFIG: StoredConfig = { version: CONFIG_VERSION, serverUrl: "" };

/** How long an INITIATED social sign-in stays adoptable — the browser leg
 * (consent + redirect) comfortably fits; after this the session deep link is
 * refused and the user restarts from Settings. */
const PENDING_SOCIAL_TTL_MS = 10 * 60_000;
const DEFAULT_AUTH: StoredAuth = { version: AUTH_VERSION, token: null, email: null };

/** Open a URL in the system browser. A throw (sync or async) fails the
 * sign-in as an `{ok:false}` value — socialSignIn awaits it. */
export type BrowserOpener = (url: string) => void | Promise<void>;

// Module-scoped install seam: sync/ never imports the platform layer — the
// composition root (createHost)
// fills this with the guarded HostPlatform.openExternal path. No opener
// installed = social sign-in refuses with an {ok:false}, never a silent
// fallback to a package-owned browser launcher.
let installedBrowserOpener: BrowserOpener | null = null;

export function setSyncBrowserOpener(opener: BrowserOpener): void {
  installedBrowserOpener = opener;
}

export type SyncAccountOptions = {
  fs?: StoreAdapter;
  configPath?: string;
  authPath?: string;
  /** Open a URL in the system browser (social sign-in). Injectable so tests
   * never launch a real browser; defaults to the installed
   * setSyncBrowserOpener seam. */
  openExternal?: BrowserOpener;
};

/** Sign-in and persistence for the optional account — the server URL and the
 * bearer session, both under ~/.inteligir. */
export class SyncAccount {
  private readonly configStore: JsonStore<StoredConfig>;
  private readonly authStore: JsonStore<StoredAuth>;
  private readonly openExternalOverride: BrowserOpener | null;
  /** The ONE in-flight social sign-in this device initiated (state nonce +
   * TTL). In-memory on purpose: the browser leg spans seconds, and a session
   * deep link arriving after a restart SHOULD be refused — it can no longer
   * be tied to a sign-in this process asked for. */
  private pendingSocial: { state: string; expiresAt: number } | null = null;

  constructor(opts: SyncAccountOptions = {}) {
    // The installed seam is read at CALL time (not captured here) so a
    // SyncAccount built before createHost fills the seam still opens.
    this.openExternalOverride = opts.openExternal ?? null;
    this.configStore = new JsonStore<StoredConfig>(
      opts.configPath ?? inteligirPath("sync-config.json"),
      SyncConfigSchema,
      DEFAULT_CONFIG,
      { fs: opts.fs, versioning: { current: CONFIG_VERSION } },
    );
    this.authStore = new JsonStore<StoredAuth>(
      opts.authPath ?? inteligirPath("sync-auth.json"),
      SyncAuthSchema,
      DEFAULT_AUTH,
      { fs: opts.fs, versioning: { current: AUTH_VERSION } },
    );
  }

  // ---- config ---------------------------------------------------------------

  getServerUrl(): string {
    return this.configStore.read().serverUrl;
  }

  /** Point this install at a server. */
  setServerUrl(serverUrl: string): void {
    this.configStore.write({ version: CONFIG_VERSION, serverUrl });
  }

  // ---- session --------------------------------------------------------------

  getToken(): string | null {
    return this.authStore.read().token;
  }

  getEmail(): string | null {
    return this.authStore.read().email;
  }

  /** The reactive shape the Account UI renders — the payload of both
   * `getAccountState` and `onAccountStateChanged`. */
  getState(): AccountState {
    const { token, email } = this.authStore.read();
    return { signedIn: token !== null, email, serverUrl: this.getServerUrl() };
  }

  /** A Better Auth client for the configured server that captures the bearer
   * token from the `set-auth-token` response header (the bearer() plugin
   * contract both sign-in and sign-up speak). Null when no server URL is
   * set. */
  private tokenCapturingClient(): {
    client: ReturnType<typeof createAuthClient>;
    token: () => string | null;
  } | null {
    const serverUrl = this.getServerUrl();
    if (serverUrl.trim() === "") return null;
    let captured: string | null = null;
    const client = createAuthClient({
      baseURL: serverUrl,
      fetchOptions: {
        onSuccess: (ctx) => {
          const token = ctx.response.headers.get("set-auth-token");
          if (token !== null && token !== "") captured = token;
        },
      },
    });
    return { client, token: () => captured };
  }

  /** Persist a captured session, or explain why there is none. */
  private adoptSession(
    email: string,
    error: { message?: string | null | undefined } | null,
    token: string | null,
  ): SyncSignInResult {
    if (error) {
      return { ok: false, error: error.message ?? "Authentication failed." };
    }
    if (token === null) {
      return { ok: false, error: "The server did not return a session token." };
    }
    this.authStore.write({ version: AUTH_VERSION, token, email });
    return { ok: true };
  }

  /** Email+password sign-in against the configured server. Captures the
   * bearer token from the `set-auth-token` header and persists it. */
  async signIn(email: string, password: string): Promise<SyncSignInResult> {
    const session = this.tokenCapturingClient();
    if (session === null) return { ok: false, error: "Set a server URL first." };
    try {
      const result = await session.client.signIn.email({ email, password });
      return this.adoptSession(email, result.error, session.token());
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  }

  /** Email+password sign-UP — the guest→account upgrade's front door. Better
   * Auth requires a display name; the email's local part serves (editable
   * later server-side, never consulted by the app). A success signs the new
   * account straight in (same token capture as signIn). */
  async signUp(email: string, password: string): Promise<SyncSignInResult> {
    const session = this.tokenCapturingClient();
    if (session === null) return { ok: false, error: "Set a server URL first." };
    const name = email.split("@")[0] ?? email;
    try {
      const result = await session.client.signUp.email({ email, password, name });
      return this.adoptSession(email, result.error, session.token());
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  }

  /** Ask the server to email a password-reset link. NEUTRAL by contract (see
   * the registry entry): the server 200s identically for known and unknown
   * emails — with timing-attack mitigation server-side — so `ok` never
   * confirms an account exists. `redirectTo: "/auth/reset"` is the server's
   * own Worker-hosted reset page (a RELATIVE path, resolved against the server
   * origin — always a trusted redirect target, same pattern as the social
   * flow's callbackPath above): the emailed link's GET leg validates the
   * token, then lands there with `?token=`. */
  async requestPasswordReset(email: string): Promise<SyncSignInResult> {
    const session = this.tokenCapturingClient();
    if (session === null) return { ok: false, error: "Set a server URL first." };
    try {
      const result = await session.client.requestPasswordReset({
        email,
        redirectTo: "/auth/reset",
      });
      if (result.error) {
        // Transport/config failures only (rate limit, reset not configured) —
        // the server never errors on an unknown email.
        return { ok: false, error: result.error.message ?? "Password-reset request failed." };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  }

  /** INITIATE a social OAuth sign-in: ask the server for the provider's
   * authorization URL and open it in the system browser. Success here means
   * "browser opened", not "signed in" — the round-trip completes when the
   * server's callback interstitial fires `inteligir://session` and
   * `completeSocialSignIn` adopts the exchanged session.
   *
   * The state nonce minted here is the anti-fixation bind: the callback URL
   * carries it to the server, the deep link echoes it back, and
   * completeSocialSignIn refuses anything that doesn't match — so a
   * world-invokable `inteligir://session` can never sign this device into a
   * session it didn't just ask for. */
  async socialSignIn(provider: string): Promise<SyncSignInResult> {
    const session = this.tokenCapturingClient();
    if (session === null) return { ok: false, error: "Set a server URL first." };
    const openExternal = this.openExternalOverride ?? installedBrowserOpener;
    if (openExternal === null) {
      return { ok: false, error: "This host cannot open a browser for sign-in." };
    }
    const state = crypto.randomBytes(16).toString("base64url");
    // Relative to the server's own origin — always a trusted callback
    // target. The same path serves errorCallbackURL: no session cookie there
    // means the interstitial renders the failure copy and mints nothing.
    const callbackPath = `/v1/auth/desktop-callback?state=${state}`;
    try {
      const result = await session.client.signIn.social({
        provider,
        disableRedirect: true,
        callbackURL: callbackPath,
        errorCallbackURL: callbackPath,
      });
      if (result.error) {
        return { ok: false, error: result.error.message ?? "Social sign-in failed." };
      }
      const url = result.data?.url;
      if (typeof url !== "string" || url === "") {
        return { ok: false, error: "The server did not return an authorization URL." };
      }
      this.pendingSocial = { state, expiresAt: Date.now() + PENDING_SOCIAL_TTL_MS };
      // Awaited inside the try: the opener's scheme guard (openExternalHttpUrl
      // refuses a non-http server-supplied URL) and any launch failure
      // land as the {ok:false} below, never an unhandled rejection.
      await openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  }

  /** COMPLETE a social sign-in — the `inteligir://session?code&state` deep
   * link lands here. Guards stack in order: the state must match the ONE
   * pending sign-in this device minted, then the code — which is NEVER a
   * credential itself — is exchanged over HTTPS at the server, and only
   * the returned bearer is adopted (same store the email sign-in path writes).
   * The pending is burned ONLY once a matching state is presented: a
   * mismatched/guessed state (a junk `inteligir://session` fired at this
   * machine) must not cancel the user's legitimate pending sign-in. The
   * 128-bit state nonce makes brute-force over the 90s window infeasible, so
   * not burning on a mismatch costs no security. */
  async completeSocialSignIn(code: string, state: string): Promise<SyncSignInResult> {
    const pending = this.pendingSocial;
    if (pending === null || Date.now() > pending.expiresAt || pending.state !== state) {
      return { ok: false, error: "Sign-in link expired — start again from Settings." };
    }
    this.pendingSocial = null;
    const base = this.getServerUrl().trim();
    if (base === "") return { ok: false, error: "Set a server URL first." };
    try {
      const response = await fetch(`${base.replace(/\/+$/, "")}/v1/auth/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        return { ok: false, error: `Sign-in exchange failed (HTTP ${response.status}).` };
      }
      const body: unknown = await response.json();
      if (!isRecord(body) || body.ok !== true) {
        const message =
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "This sign-in link is invalid or expired — try again.";
        return { ok: false, error: message };
      }
      const token = body.token;
      if (typeof token !== "string" || token === "") {
        return { ok: false, error: "The server did not return a session token." };
      }
      const email = typeof body.email === "string" ? body.email : null;
      this.authStore.write({ version: AUTH_VERSION, token, email });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  }

  /** What the configured server can serve (social buttons). Fail-soft: no URL
   * / unreachable / malformed all report no capabilities — the account UI just
   * renders without social buttons. */
  async getCapabilities(): Promise<AccountCapabilities> {
    const base = this.getServerUrl().trim();
    if (base === "") return { socialProviders: [] };
    try {
      const response = await fetch(`${base.replace(/\/+$/, "")}/v1/capabilities`);
      if (!response.ok) return { socialProviders: [] };
      const body: unknown = await response.json();
      if (!isRecord(body)) return { socialProviders: [] };
      const listed = body.socialProviders;
      if (!Array.isArray(listed)) return { socialProviders: [] };
      return {
        socialProviders: listed.filter((entry): entry is string => typeof entry === "string"),
      };
    } catch {
      return { socialProviders: [] };
    }
  }

  /** Clear the local session; best-effort remote revoke first. */
  async signOut(): Promise<void> {
    const serverUrl = this.getServerUrl();
    const token = this.getToken();
    if (serverUrl.trim() !== "" && token !== null) {
      try {
        const client = createAuthClient({
          baseURL: serverUrl,
          fetchOptions: { headers: { Authorization: `Bearer ${token}` } },
        });
        await client.signOut();
      } catch {
        // Best-effort — the local token is cleared below regardless.
      }
    }
    this.authStore.write({ version: AUTH_VERSION, token: null, email: null });
  }

  /** Disable writes on the underlying stores. Called by resetSyncAccount during
   * logout teardown, before ~/.inteligir is wiped, so a late write can't
   * resurrect a store file from a warm cache. */
  close(): void {
    this.configStore.close();
    this.authStore.close();
  }
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors the other host managers.
// ---------------------------------------------------------------------------

let instance: SyncAccount | null = null;

export function getSyncAccount(): SyncAccount {
  if (!instance) instance = new SyncAccount();
  return instance;
}

export function resetSyncAccount(): void {
  instance?.close();
  instance = null;
}
