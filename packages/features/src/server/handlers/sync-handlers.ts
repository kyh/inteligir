import type { HandlerRegistrar } from "../lib/handler-registry";
import { getSyncCoordinator } from "../sync/sync-coordinator";

export function registerSyncHandlers(handle: HandlerRegistrar): void {
  handle("getSyncState", () => getSyncCoordinator().getState());
  handle("setSyncConfig", (patch) => getSyncCoordinator().setConfig(patch));
  handle("syncSignIn", ({ email, password }) => getSyncCoordinator().signIn(email, password));
  handle("syncSignOut", () => getSyncCoordinator().signOut());
  handle("syncNow", () => getSyncCoordinator().syncNow());
}
