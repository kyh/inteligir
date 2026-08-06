import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";

export function registerDelegationHandlers(
  handle: HandlerRegistrar,
  services: Pick<HostServices, "delegations">,
): void {
  handle("createDelegation", (params) => services.delegations.createDelegation(params));
  handle("listDelegations", () => ({ delegations: services.delegations.getDelegations() }));
  handle("cancelDelegation", (id) => services.delegations.cancelDelegation(id));
  handle("restoreDelegationSnapshot", (id) => services.delegations.restoreSnapshot(id));
}
