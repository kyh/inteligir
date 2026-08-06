import { takePendingDeepLinkNav } from "../capture/deep-link-service";
import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";

export function registerCaptureHandlers(
  handle: HandlerRegistrar,
  services: Pick<HostServices, "capture">,
): void {
  handle("ackCapture", ({ id, outcome }) => {
    services.capture.ack(id, outcome);
  });
  handle("takePendingDeepLinkNav", () => takePendingDeepLinkNav());
}
