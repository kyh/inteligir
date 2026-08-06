import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";

export function registerNotificationHandlers(
  handle: HandlerRegistrar,
  services: Pick<HostServices, "notifications">,
): void {
  handle("getNotificationSettings", () => services.notifications.getSettings());
  handle("updateNotificationSettings", (patch) => services.notifications.updateSettings(patch));
}
