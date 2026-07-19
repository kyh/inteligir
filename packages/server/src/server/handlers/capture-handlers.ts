import { getCaptureManager } from "../capture/capture-manager";
import { takePendingDeepLinkNav } from "../capture/deep-link-service";
import type { HandlerRegistrar } from "./handler-registry";

export function registerCaptureHandlers(handle: HandlerRegistrar): void {
  handle("ackCapture", ({ id, outcome }) => {
    getCaptureManager().ack(id, outcome);
  });
  handle("takePendingDeepLinkNav", () => takePendingDeepLinkNav());
}
