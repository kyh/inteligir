import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";

export function registerUiStateHandlers(
  handle: HandlerRegistrar,
  services: Pick<HostServices, "uiState">,
): void {
  handle("getUiState", () => services.uiState.getAll());
  handle("setUiState", ({ key, value }) => {
    services.uiState.set(key, value);
  });
}
