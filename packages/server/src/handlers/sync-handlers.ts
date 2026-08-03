import type { HandlerRegistrar } from "./handler-registry";
import { getSyncCoordinator } from "@repo/sync/sync-coordinator";

export function registerSyncHandlers(handle: HandlerRegistrar): void {
  handle("getSyncState", () => getSyncCoordinator().getState());
  handle("setSyncConfig", (patch) => getSyncCoordinator().setConfig(patch));
  handle("syncSignIn", ({ email, password }) => getSyncCoordinator().signIn(email, password));
  handle("syncSignUp", ({ email, password }) => getSyncCoordinator().signUp(email, password));
  handle("syncSocialSignIn", ({ provider }) => getSyncCoordinator().socialSignIn(provider));
  handle("syncRequestPasswordReset", ({ email }) =>
    getSyncCoordinator().requestPasswordReset(email),
  );
  handle("getAccountCapabilities", () => getSyncCoordinator().getCapabilities());
  handle("syncSignOut", () => getSyncCoordinator().signOut());
  handle("syncNow", (opts) => getSyncCoordinator().syncNow(opts));
}
