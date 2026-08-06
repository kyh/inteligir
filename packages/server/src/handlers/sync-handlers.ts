import { emitEvent } from "../events";
import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";

/**
 * Account channels. Every mutation re-emits the whole state so the Account
 * settings section stays reactive without polling; the ONE other emitter is
 * the deep-link service, which completes a social sign-in nobody is awaiting.
 */
export function registerSyncHandlers(
  handle: HandlerRegistrar,
  services: Pick<HostServices, "account">,
): void {
  const emitState = (): void => {
    emitEvent("onAccountStateChanged", services.account.getState());
  };

  handle("getAccountState", () => services.account.getState());
  handle("setAccountServerUrl", ({ serverUrl }) => {
    services.account.setServerUrl(serverUrl);
    emitState();
    return services.account.getState();
  });
  handle("syncSignIn", async ({ email, password }) => {
    const result = await services.account.signIn(email, password);
    emitState();
    return result;
  });
  handle("syncSignUp", async ({ email, password }) => {
    const result = await services.account.signUp(email, password);
    emitState();
    return result;
  });
  // Initiation only — the browser leg completes through the deep link, which
  // emits both the verdict and the state.
  handle("syncSocialSignIn", ({ provider }) => services.account.socialSignIn(provider));
  handle("syncRequestPasswordReset", ({ email }) => services.account.requestPasswordReset(email));
  handle("getAccountCapabilities", () => services.account.getCapabilities());
  handle("syncSignOut", async () => {
    await services.account.signOut();
    emitState();
  });
}
