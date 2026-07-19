import { getAppState, transition } from "../app/app-machine";
import type { HandlerRegistrar } from "./handler-registry";

export function registerLifecycleHandlers(handle: HandlerRegistrar): void {
  handle("getAppState", () => getAppState());
  handle("transition", (event) => {
    transition(event);
  });
}
