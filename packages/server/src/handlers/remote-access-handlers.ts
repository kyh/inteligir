import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";

export function registerRemoteAccessHandlers(
  handle: HandlerRegistrar,
  services: Pick<HostServices, "remoteAccess">,
): void {
  handle("getRemoteAccessState", () => services.remoteAccess.getState());
  handle("setRemoteAccessConfig", (patch) => services.remoteAccess.setConfig(patch));
  handle("createPairingToken", () => services.remoteAccess.createPairingToken());
  handle("revokeRemoteDevice", ({ id }) => services.remoteAccess.revokeDevice(id));
}
