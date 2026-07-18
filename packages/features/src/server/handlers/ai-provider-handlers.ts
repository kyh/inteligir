import { applySelectedProviderChange } from "../app/app-machine";
import {
  connectAiProvider,
  disconnectAiProvider,
  getAiProviderSettings,
  getSelectedProvider,
  setAiProviderConfig,
} from "../provider/provider-service";
import type { HandlerRegistrar } from "../lib/handler-registry";

export function registerAiProviderHandlers(handle: HandlerRegistrar): void {
  handle("getAiProviderSettings", () => getAiProviderSettings());

  // A patch that changes the EFFECTIVE selection rolls the live sessions
  // (resume, not newSession) so the very next turn runs the new
  // provider+model. Awaited so the returned snapshot reflects a world where
  // the switch is fully applied.
  handle("setAiProviderConfig", async (patch) => {
    const before = getSelectedProvider();
    const settings = setAiProviderConfig(patch);
    const after = getSelectedProvider();
    if (before.provider !== after.provider || before.modelId !== after.modelId) {
      await applySelectedProviderChange();
    }
    return settings;
  });

  // Connecting the SELECTED provider also rolls the sessions so fresh
  // credentials are picked up immediately (a non-selected provider's connect
  // touches nothing live).
  handle("connectAiProvider", async ({ provider }) => {
    const result = await connectAiProvider(provider);
    if (result.ok && provider === getSelectedProvider().provider) {
      await applySelectedProviderChange();
    }
    return result;
  });

  handle("disconnectAiProvider", ({ provider }) => disconnectAiProvider(provider));
}
