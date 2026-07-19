import type { HandlerRegistrar } from "./handler-registry";
import { getNotifications } from "../notifications";

export function registerNotificationHandlers(handle: HandlerRegistrar): void {
  handle("getNotificationSettings", () => getNotifications().getSettings());
  handle("updateNotificationSettings", (patch) => getNotifications().updateSettings(patch));
}
