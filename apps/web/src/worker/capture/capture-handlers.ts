// Deep-link capture's two Bridge handlers, over this object's own inbox.

import type { HandlerRegistrar } from "../host/handler-registry";
import type { CaptureInbox } from "./capture-inbox";
import type { CaptureService } from "./capture-service";

export type CaptureServices = {
  readonly inbox: CaptureInbox;
  readonly service: CaptureService;
};

export function registerCaptureHandlers(handle: HandlerRegistrar, services: CaptureServices): void {
  handle("ackCapture", ({ id, outcome }) => services.inbox.ack(id, outcome));
  handle("takePendingDeepLinkNav", () => services.service.takePendingNav());
}
