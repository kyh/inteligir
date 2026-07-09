// ---------------------------------------------------------------------------
// vault-app:// — the privileged custom protocol that serves a vault `.html`
// file (and its sibling assets) into a sandboxed iframe as a runnable "HTML
// App". This is a NEW privileged surface: review it like VaultManager.resolve()
// (path games, token reuse). Two guards gate every response:
//
//  1. Token: the URL must carry `?token=` matching a per-open token the host
//     minted (mintHtmlAppToken). An unminted / stale token is a hard 403 — a
//     stray navigation or a note's crafted `vault-app://` link resolves to
//     nothing.
//  2. Confinement: the path is resolved through VaultManager's confined read
//     (readBytes → resolve()), which realpath-rejects `..`, absolute, and
//     symlink escapes exactly like every other file op. We NEVER touch `fs`.
//
// For `.html` responses only, the host injects (before running the app) the
// runtime bridge, a theme-variable stylesheet, the Tailwind browser compiler,
// and Alpine — all VENDORED and inlined (no CDN, ever; see resources/
// html-app-runtime). The app is thus ONE self-contained file the agent writes;
// deps are the host's contract with it. Injected nodes are tagged
// `data-inteligir-injected`.
//
// URL shape: vault-app://app/<vault-relative-path>?token=<per-open token>
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { protocol } from "electron";

import { getVaultManager } from "@repo/features/server/vault/vault";

import { injectHtmlAppRuntime } from "@/html-app-inject";

const VAULT_APP_SCHEME = "vault-app";

// ---------------------------------------------------------------------------
// Per-open token store — held ONLY in the main process. A fresh token is minted
// each time the renderer opens an app; it authorizes vault-app:// reads for
// that open. Bounded FIFO so hot-reloads (which mint a new token per remount)
// can't grow it without limit; a handful of live apps is the realistic ceiling.
// ---------------------------------------------------------------------------

const MAX_LIVE_TOKENS = 32;
const liveTokens = new Set<string>();

/** Mint a per-open token authorizing vault-app:// reads. Random 256-bit hex. */
export function mintHtmlAppToken(): string {
  const token = randomBytes(32).toString("hex");
  liveTokens.add(token);
  if (liveTokens.size > MAX_LIVE_TOKENS) {
    const oldest = liveTokens.values().next().value;
    if (oldest !== undefined) liveTokens.delete(oldest);
  }
  return token;
}

/** Exported for tests, which drive `resolveVaultAppRequest` against the real
 * module-level token store (mint/revoke) rather than a fake `isValidToken`. */
export function isValidToken(token: string): boolean {
  return liveTokens.has(token);
}

/** Revoke a token immediately (the view's close/unmount path calls this via
 * IPC). The normal path — the FIFO bound above is only a backstop for tokens
 * whose closing view never got the chance to revoke (crash, hard reload). */
export function revokeHtmlAppToken(token: string): void {
  liveTokens.delete(token);
}

// ---------------------------------------------------------------------------
// Content types — the small set an app plus its assets realistically use.
// ---------------------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function extname(path: string): string {
  const slash = path.lastIndexOf("/");
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// The request resolver — pure over its deps so tests can drive it with a real
// VaultManager over a temp vault (confinement) and a fake token set.
// ---------------------------------------------------------------------------

export type VaultAppResult =
  | { kind: "ok"; contentType: string; body: Uint8Array }
  | { kind: "error"; status: number; message: string };

export type VaultAppDeps = {
  /** Confined vault read (VaultManager.readBytes) — throws on escape/missing. */
  readBytes: (rel: string) => Uint8Array;
  isValidToken: (token: string) => boolean;
};

export function resolveVaultAppRequest(rawUrl: string, deps: VaultAppDeps): VaultAppResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: "error", status: 400, message: "bad url" };
  }
  // Only the `app` authority serves vault files; anything else is not us.
  if (url.hostname !== "app") return { kind: "error", status: 404, message: "not found" };

  const token = url.searchParams.get("token");
  if (token === null || !deps.isValidToken(token)) {
    return { kind: "error", status: 403, message: "forbidden" };
  }

  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    return { kind: "error", status: 400, message: "bad path" };
  }
  if (rel === "") return { kind: "error", status: 404, message: "not found" };

  let bytes: Uint8Array;
  try {
    // Confinement lives here: readBytes → resolve() realpath-rejects traversal,
    // absolute, and symlink escapes. A rejection reads as "not found".
    bytes = deps.readBytes(rel);
  } catch {
    return { kind: "error", status: 404, message: "not found" };
  }

  const ext = extname(rel);
  if (ext === ".html") {
    const injected = injectHtmlAppRuntime(new TextDecoder().decode(bytes));
    return {
      kind: "ok",
      contentType: CONTENT_TYPES[".html"] ?? "text/html; charset=utf-8",
      body: new TextEncoder().encode(injected),
    };
  }
  return { kind: "ok", contentType: contentTypeFor(ext), body: bytes };
}

// ---------------------------------------------------------------------------
// Electron wiring
// ---------------------------------------------------------------------------

/** Register the scheme's privileges. MUST run before app `ready` (Electron
 * requirement) — call at module top-level in the main entry. `standard`+`secure`
 * give it an http-like origin so fetch/XHR from the app work under
 * `supportFetchAPI`+`corsEnabled`. */
export function registerVaultAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: VAULT_APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

/** Install the protocol handler. Call after app `ready`. */
export function registerVaultAppProtocol(): void {
  protocol.handle(VAULT_APP_SCHEME, (request) => {
    const result = resolveVaultAppRequest(request.url, {
      readBytes: (rel) => getVaultManager().readBytes(rel),
      isValidToken,
    });
    if (result.kind === "error") {
      return new Response(result.message, { status: result.status });
    }
    // Copy into a fresh ArrayBuffer-backed body: the confined read can return a
    // Uint8Array<ArrayBufferLike>, which the DOM Response's BodyInit rejects;
    // `new Uint8Array(view).buffer` is a definite ArrayBuffer (a cheap copy).
    return new Response(new Uint8Array(result.body).buffer, {
      status: 200,
      headers: { "content-type": result.contentType, "cache-control": "no-store" },
    });
  });
}
