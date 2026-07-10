import type { HandlerRegistrar } from "../lib/handler-registry";
import { getRemoteAccessManager } from "../transport/remote-access-manager";

export function registerRemoteAccessHandlers(handle: HandlerRegistrar): void {
  handle("getRemoteAccessState", () => getRemoteAccessManager().getState());
  handle("setRemoteAccessConfig", (patch) => getRemoteAccessManager().setConfig(patch));
  handle("createPairingToken", () => getRemoteAccessManager().createPairingToken());
  handle("revokeRemoteDevice", ({ id }) => getRemoteAccessManager().revokeDevice(id));
}
