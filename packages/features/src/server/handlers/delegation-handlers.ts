import { getDelegationManager } from "../delegation/delegation-manager";
import type { HandlerRegistrar } from "../lib/handler-registry";

export function registerDelegationHandlers(handle: HandlerRegistrar): void {
  handle("createDelegation", (params) => getDelegationManager().createDelegation(params));
  handle("listDelegations", () => ({ delegations: getDelegationManager().getDelegations() }));
  handle("cancelDelegation", (id) => getDelegationManager().cancelDelegation(id));
  handle("restoreDelegationSnapshot", (id) => getDelegationManager().restoreSnapshot(id));
}
