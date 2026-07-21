// Provider credentials. Reaches pi through its ModelRuntime (0.80's canonical
// credential/model handle, backed by auth.json); the runtime is lazy so a
// logout-flow that deletes auth.json can null the cached instance and the
// next login rebuilds it. Every function is provider-parametric — WHICH
// provider is selected is host state (server/provider/), composed in by the
// callers: agent/ receives, never chooses.

import fs from "node:fs";

import {
  createModelRuntime,
  hasStoredAuth,
  loginWithProvider,
  removeAuth,
} from "@repo/agent/pi/auth";
import type { ModelRuntime } from "@repo/agent/pi/pi-types";

import { AUTH_PATH } from "./paths";

let runtimePromise: Promise<ModelRuntime> | null = null;
// Bumped on every resetAuthStorage() (i.e. a RESET wiped ~/.inteligir). An
// OAuth flow that was already out in the browser when the wipe happened
// completes against the OLD runtime and would re-write auth.json AFTER the
// wipe — a "connected" provider surviving the reset. login() checks the
// epoch after the round-trip and undoes such a stale completion.
let authEpoch = 0;

/** The host's ONE ModelRuntime, shared by every session (chat, delegation,
 * inline AI, ghost text) so login/logout state stays coherent. Lazy +
 * promise-cached: construction is async in 0.80 (auth.json + models.json
 * reads), and PiAgent.start() awaits this thunk. */
export function getModelRuntime(): Promise<ModelRuntime> {
  if (!runtimePromise) runtimePromise = createModelRuntime(AUTH_PATH);
  return runtimePromise;
}

/** Reset the cached runtime. Called from teardownResources so a fresh
 * login after logout reads the rebuilt auth.json instead of stale creds. */
export function resetAuthStorage(): void {
  runtimePromise = null;
  authEpoch++;
}

/** Credentials cached on-device for `provider` — a stored auth.json entry.
 * Sync (Settings snapshots and delegation gating are sync), via pi's
 * one-off readStoredCredential; the auth.json existence guard keeps a
 * post-logout-wipe state from reading as "connected". */
export function isProviderAuthed(provider: string): boolean {
  if (!fs.existsSync(AUTH_PATH)) return false;
  return hasStoredAuth(AUTH_PATH, provider);
}

// NOTE: after a successful login the shell write-suspension must be lifted
// (resumeShellWrites). That is the host's concern — server/boot/agent-wiring.ts
// wraps this in loginAgent(); call that, not this, from app lifecycle code.
// `openUrl` is the host's browser opener (HostPlatform.openExternal via the
// guarded openExternalHttpUrl) — agent/ receives, never owns an OS capability.
export async function login(
  provider: string,
  openUrl: (url: string) => void | Promise<void>,
): Promise<void> {
  const epoch = authEpoch;
  await loginWithProvider(await getModelRuntime(), provider, {
    onAuth: (info) => {
      // Fire-and-forget: pi keeps waiting for the OAuth round-trip either
      // way; a failed browser launch surfaces as a warn, not a turn error.
      void (async () => openUrl(info.url))().catch((err: unknown) => {
        console.warn("[agent] failed to open the auth URL in a browser:", err);
      });
    },
  });
  if (epoch !== authEpoch) {
    // A RESET wiped ~/.inteligir while this OAuth round-trip was out in the
    // browser: the completion just resurrected this provider's credential
    // post-wipe. Undo it through the CURRENT runtime (so credentials a
    // post-reset re-login legitimately wrote for other providers survive)
    // and fail the connect — the user asked for a wipe, not a reconnect.
    await logoutProvider(provider);
    throw new Error("Sign-in was interrupted by an app data reset — connect again.");
  }
}

/** Drop `provider`'s credentials from auth.json (Settings "Disconnect").
 * Async in 0.80: the credential store's delete is a serialized, file-locked
 * write. */
export async function logoutProvider(provider: string): Promise<void> {
  await removeAuth(await getModelRuntime(), provider);
}
