import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";

export function registerSyncHandlers(
  handle: HandlerRegistrar,
  services: Pick<HostServices, "sync">,
): void {
  handle("getSyncState", () => services.sync.getState());
  handle("setSyncConfig", (patch) => services.sync.setConfig(patch));
  handle("syncSignIn", ({ email, password }) => services.sync.signIn(email, password));
  handle("syncSignUp", ({ email, password }) => services.sync.signUp(email, password));
  handle("syncSocialSignIn", ({ provider }) => services.sync.socialSignIn(provider));
  handle("syncRequestPasswordReset", ({ email }) => services.sync.requestPasswordReset(email));
  handle("getAccountCapabilities", () => services.sync.getCapabilities());
  handle("syncSignOut", () => services.sync.signOut());
  handle("syncNow", (opts) => services.sync.syncNow(opts));
  handle("getSyncDevices", () => services.sync.listDevices());
  handle("createSyncPairingOffer", () => services.sync.createPairingOffer());
  handle("revokeSyncDevice", ({ publicKey }) => services.sync.revokeDevice(publicKey));
  handle("reconnectSyncVault", () => services.sync.reconnectVault());
  handle("disconnectSyncVault", () => services.sync.disconnectVault());
}
