import { generateInline } from "../app/inline-ai";
import { getDelegationManager } from "../delegation/delegation-manager";
import type { HandlerRegistrar } from "../lib/handler-registry";

export function registerDelegationHandlers(handle: HandlerRegistrar): void {
  handle("createDelegation", (params) => getDelegationManager().createDelegation(params));
  handle("listDelegations", () => ({ delegations: getDelegationManager().getDelegations() }));
  handle("cancelDelegation", (id) => getDelegationManager().cancelDelegation(id));
  handle("generateInlineAi", (params) => generateInline(params.prompt, params.requestId));
}
