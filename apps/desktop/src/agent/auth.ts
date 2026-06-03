// Provider credentials + one-shot completions. Both reach pi-ai through the
// same AuthStorage; the storage is lazy so a logout-flow that deletes
// auth.json can null the cached instance and the next login rebuilds it.

import fs from "node:fs";
import open from "open";

import { createAuthStorage, hasAuth, loginWithProvider } from "@repo/pi-driver/auth";
import { completeText } from "@repo/pi-driver/complete";
import { resolveModel } from "@repo/pi-driver/model";
import type { AuthStorage } from "@repo/pi-driver/pi-types";

import { AUTH_PATH, AUTH_PROVIDER, MODEL_ID } from "@/agent/paths";
import { resumeShellWrites } from "@/main/shell";

let authStorage: AuthStorage | null = null;

export function getAuthStorage(): AuthStorage {
  if (!authStorage) authStorage = createAuthStorage(AUTH_PATH);
  return authStorage;
}

/** Reset the cached AuthStorage. Called from teardownResources so a fresh
 * login after logout reads the rebuilt auth.json instead of stale creds. */
export function resetAuthStorage(): void {
  authStorage = null;
}

export function isLoggedIn(): boolean {
  if (!fs.existsSync(AUTH_PATH)) return false;
  return hasAuth(getAuthStorage(), AUTH_PROVIDER);
}

export async function login(): Promise<void> {
  await loginWithProvider(getAuthStorage(), AUTH_PROVIDER, {
    onAuth: (info) => {
      void open(info.url);
    },
  });
  // resetShellCache (on a previous logout) suspended shell writes to keep an
  // in-flight setInstanceState from recreating ~/.inteligir. After successful
  // re-auth, the workspace is allowed to materialize again on the next write.
  resumeShellWrites();
}

/**
 * One-shot model completion outside the agent session — used by "live"
 * widget actions that fill UI state from the model without spawning a
 * chat turn. Uses the same model + credentials as the running agent.
 */
export function completeOnce(prompt: string, system?: string): Promise<string> {
  return completeText(getAuthStorage(), resolveModel(AUTH_PROVIDER, MODEL_ID), prompt, system);
}
