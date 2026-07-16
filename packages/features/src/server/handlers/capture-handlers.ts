import { getCaptureManager } from "../capture/capture-manager";
import type { HandlerRegistrar } from "../lib/handler-registry";

export function registerCaptureHandlers(handle: HandlerRegistrar): void {
  handle("ackCapture", ({ id, outcome }) => {
    getCaptureManager().ack(id, outcome);
  });
}
