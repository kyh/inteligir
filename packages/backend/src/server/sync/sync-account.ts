// ---------------------------------------------------------------------------
// SyncAccount — the desktop's sign-in + config state for vault sync, persisted
// under ~/.inteligir (never in the vault). Three versioned JsonStores:
//   - sync-config.json    { enabled, coordinatorUrl }  — the runtime gate
//   - sync-auth.json      { token, email }             — the bearer session
//   - sync-vault-id.json  { vaultId }                  — the stable install id
//
// Auth is Better Auth email+password against the coordinator's `/api/auth/*`.
// The coordinator runs the bearer() plugin, so sign-in returns the session
// token in the `set-auth-token` response header; `onSuccess` captures it and we
// stash it so `createHttpSyncPort` can send `Authorization: Bearer <token>` on
// the vault routes. The Better Auth client is framework-agnostic and runs on
// node's global fetch — no react/expo wrapper here.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { type Static, Type } from "@sinclair/typebox";
import { createAuthClient } from "better-auth/client";
import open from "open";

import {
  JsonStore,
  inteligirPath,
  rejectLegacyVersion,
  type FsAdapter,
} from "../storage/json-store";
import { isRecord, toErrorMessage } from "@repo/bridge/wire-helpers";
import type { AccountCapabilities, SyncSignInResult } from "@repo/bridge/sync";

// ---------------------------------------------------------------------------
// Store schemas — each versioned; a legacy/corrupt file resets to the default
// (config off, signed out, a fresh install id), never data loss (no note
// content lives here).
// ---------------------------------------------------------------------------

const CONFIG_VERSION = 1;
const AUTH_VERSION = 1;
const VAULT_ID_VERSION = 1;

const SyncConfigSchema = Type.Object(
  {
    version: Type.Literal(CONFIG_VERSION),
    enabled: Type.Boolean(),
    coordinatorUrl: Type.String(),
  },
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

const SyncVaultIdSchema = Type.Object(
  { version: Type.Literal(VAULT_ID_VERSION), vaultId: Type.String() },
  { additionalProperties: false },
);

export type SyncConfig = { enabled: boolean; coordinatorUrl: string };

// Stored shapes carry the version field; getters project it away. Keeping the
// in-memory type equal to the schema's Static lets JsonStore use its identity
// decode/encode (no contravariant decode callback), and version stays internal.
type StoredConfig = Static<typeof SyncConfigSchema>;
type StoredAuth = Static<typeof SyncAuthSchema>;
type StoredVaultId = Static<typeof SyncVaultIdSchema>;

const DEFAULT_CONFIG: StoredConfig = {
  version: CONFIG_VERSION,
  enabled: false,
  coordinatorUrl: "",
};
const DEFAULT_AUTH: StoredAuth = { version: AUTH_VERSION, token: null, email: null };
const DEFAULT_VAULT_ID: StoredVaultId = { version: VAULT_ID_VERSION, vaultId: "" };

const rejectLegacy = rejectLegacyVersion("sync");

export type SyncAccountOptions = {
  fs?: FsAdapter;
  configPath?: string;
  authPath?: string;
  vaultIdPath?: string;
  /** Open a URL in the system browser (social sign-in). Injectable so tests
   * never launch a real browser; defaults to the `open` package. */
  openExternal?: (url: string) => void;
};

/** Signing/persistence for vault sync — the config gate, the bearer session,
 * and the install-stable vault id. All three live under ~/.inteligir. */
export class SyncAccount {
  private readonly configStore: JsonStore<StoredConfig>;
  private readonly authStore: JsonStore<StoredAuth>;
  private readonly vaultIdStore: JsonStore<StoredVaultId>;
  private readonly openExternal: (url: string) => void;

  constructor(opts: SyncAccountOptions = {}) {
    this.openExternal =
      opts.openExternal ??
      ((url) => {
        void open(url);
      });
    this.configStore = new JsonStore<StoredConfig>(
      opts.configPath ?? inteligirPath("sync-config.json"),
      SyncConfigSchema,
      DEFAULT_CONFIG,
      {
        fs: opts.fs,
        mode: 0o600,
        versioning: { current: CONFIG_VERSION, fromLegacy: rejectLegacy },
      },
    );
    this.authStore = new JsonStore<StoredAuth>(
      opts.authPath ?? inteligirPath("sync-auth.json"),
      SyncAuthSchema,
      DEFAULT_AUTH,
      { fs: opts.fs, mode: 0o600, versioning: { current: AUTH_VERSION, fromLegacy: rejectLegacy } },
    );
    this.vaultIdStore = new JsonStore<StoredVaultId>(
      opts.vaultIdPath ?? inteligirPath("sync-vault-id.json"),
      SyncVaultIdSchema,
      DEFAULT_VAULT_ID,
      {
        fs: opts.fs,
        mode: 0o600,
        versioning: { current: VAULT_ID_VERSION, fromLegacy: rejectLegacy },
      },
    );
  }

  // ---- config ---------------------------------------------------------------

  getConfig(): SyncConfig {
    const { enabled, coordinatorUrl } = this.configStore.read();
    return { enabled, coordinatorUrl };
  }

  /** Patch config; an omitted field keeps its current value (the IPC payload
   * makes both optional). */
  setConfig(patch: { enabled?: boolean; coordinatorUrl?: string }): SyncConfig {
    const next = this.configStore.update((current) => ({
      version: CONFIG_VERSION,
      enabled: patch.enabled ?? current.enabled,
      coordinatorUrl: patch.coordinatorUrl ?? current.coordinatorUrl,
    }));
    return { enabled: next.enabled, coordinatorUrl: next.coordinatorUrl };
  }

  // ---- session --------------------------------------------------------------

  getToken(): string | null {
    return this.authStore.read().token;
  }

  getEmail(): string | null {
    return this.authStore.read().email;
  }

  /** A stable per-install vault id, minted + persisted on first use. The
   * coordinator's first-writer claim ties it to the signed-in user. */
  getVaultId(): string {
    const stored = this.vaultIdStore.read().vaultId;
    if (stored !== "") return stored;
    const id = crypto.randomUUID();
    this.vaultIdStore.write({ version: VAULT_ID_VERSION, vaultId: id });
    return id;
  }

  /** A Better Auth client for the configured coordinator that captures the
   * bearer token from the `set-auth-token` response header (the bearer()
   * plugin contract both sign-in and sign-up speak). Null when no coordinator
   * URL is set. */
  private tokenCapturingClient(): {
    client: ReturnType<typeof createAuthClient>;
    token: () => string | null;
  } | null {
    const { coordinatorUrl } = this.getConfig();
    if (coordinatorUrl.trim() === "") return null;
    let captured: string | null = null;
    const client = createAuthClient({
      baseURL: coordinatorUrl,
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
      return { ok: false, error: "Coordinator did not return a session token." };
    }
    this.authStore.write({ version: AUTH_VERSION, token, email });
    return { ok: true };
  }

  /** Email+password sign-in against the configured coordinator. Captures the
   * bearer token from the `set-auth-token` header and persists it. */
  async signIn(email: string, password: string): Promise<SyncSignInResult> {
    const session = this.tokenCapturingClient();
    if (session === null) return { ok: false, error: "Set a coordinator URL first." };
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
    if (session === null) return { ok: false, error: "Set a coordinator URL first." };
    const name = email.split("@")[0] ?? email;
    try {
      const result = await session.client.signUp.email({ email, password, name });
      return this.adoptSession(email, result.error, session.token());
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  }

  /** INITIATE a social OAuth sign-in: ask the coordinator for the provider's
   * authorization URL and open it in the system browser. The round-trip
   * finishes there — capturing the resulting session on this device needs the
   * deep-link callback (Phase 4), so success here means "browser opened",
   * not "signed in". */
  async socialSignIn(provider: string): Promise<SyncSignInResult> {
    const session = this.tokenCapturingClient();
    if (session === null) return { ok: false, error: "Set a coordinator URL first." };
    try {
      const result = await session.client.signIn.social({ provider, disableRedirect: true });
      if (result.error) {
        return { ok: false, error: result.error.message ?? "Social sign-in failed." };
      }
      const url = result.data?.url;
      if (typeof url !== "string" || url === "") {
        return { ok: false, error: "Coordinator did not return an authorization URL." };
      }
      this.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  }

  /** What the configured coordinator can serve (social buttons). Fail-soft:
   * no URL / unreachable / malformed all report no capabilities — the account
   * UI just renders without social buttons. */
  async getCapabilities(): Promise<AccountCapabilities> {
    const { coordinatorUrl } = this.getConfig();
    const base = coordinatorUrl.trim();
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
    const { coordinatorUrl } = this.getConfig();
    const token = this.getToken();
    if (coordinatorUrl.trim() !== "" && token !== null) {
      try {
        const client = createAuthClient({
          baseURL: coordinatorUrl,
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
    this.vaultIdStore.close();
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
