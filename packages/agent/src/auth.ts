// Provider credentials. Reaches pi-ai through an AuthStorage; the storage is
// lazy so a logout-flow that deletes auth.json can null the cached instance and
// the next login rebuilds it. Every function is provider-parametric — WHICH
// provider is selected is host state (server/provider/), composed in by the
// callers: agent/ receives, never chooses.

import fs from "node:fs";
import open from "open";

import { createAuthStorage, hasAuth, loginWithProvider, removeAuth } from "@repo/agent/pi/auth";
import type { AuthStorage } from "@repo/agent/pi/pi-types";

import { AUTH_PATH } from "./paths";

let authStorage: AuthStorage | null = null;
// Bumped on every resetAuthStorage() (i.e. a RESET wiped ~/.inteligir). An
// OAuth flow that was already out in the browser when the wipe happened
// completes against the OLD storage and would re-write auth.json AFTER the
// wipe — a "connected" provider surviving the reset. login() checks the
// epoch after the round-trip and undoes such a stale completion.
let authEpoch = 0;

export function getAuthStorage(): AuthStorage {
  if (!authStorage) authStorage = createAuthStorage(AUTH_PATH);
  return authStorage;
}

/** Reset the cached AuthStorage. Called from teardownResources so a fresh
 * login after logout reads the rebuilt auth.json instead of stale creds. */
export function resetAuthStorage(): void {
  authStorage = null;
  authEpoch++;
}

/** Credentials cached on-device for `provider`. The auth.json existence guard
 * keeps env-var API keys from reading as "connected" after a logout wipe. */
export function isProviderAuthed(provider: string): boolean {
  if (!fs.existsSync(AUTH_PATH)) return false;
  return hasAuth(getAuthStorage(), provider);
}

// NOTE: after a successful login the shell write-suspension must be lifted
// (resumeShellWrites). That is the host's concern — server/boot/agent-wiring.ts
// wraps this in loginAgent(); call that, not this, from app lifecycle code.
export async function login(provider: string): Promise<void> {
  const epoch = authEpoch;
  await loginWithProvider(getAuthStorage(), provider, {
    onAuth: (info) => {
      void open(info.url);
    },
  });
  if (epoch !== authEpoch) {
    // A RESET wiped ~/.inteligir while this OAuth round-trip was out in the
    // browser: the completion just resurrected this provider's credential
    // post-wipe. Undo it through the CURRENT storage (so credentials a
    // post-reset re-login legitimately wrote for other providers survive)
    // and fail the connect — the user asked for a wipe, not a reconnect.
    logoutProvider(provider);
    throw new Error("Sign-in was interrupted by an app data reset — connect again.");
  }
}

/** Drop `provider`'s credentials from auth.json (Settings "Disconnect"). */
export function logoutProvider(provider: string): void {
  removeAuth(getAuthStorage(), provider);
}
