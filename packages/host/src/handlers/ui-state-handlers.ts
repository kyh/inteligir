import type { HandlerRegistrar } from "../lib/handler-registry";
import { getUiState } from "../ui-state";

export function registerUiStateHandlers(handle: HandlerRegistrar): void {
  handle("getUiState", () => getUiState().getAll());
  handle("setUiState", ({ key, value }) => {
    getUiState().set(key, value);
  });
}
