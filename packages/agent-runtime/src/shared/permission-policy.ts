// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { PermissionEscalation } from "../vocabulary/shared-types.js";

export interface InteractiveRequestPolicyInput {
  permissionEscalation: PermissionEscalation | null;
}

export function shouldAutoDenyInteractiveRequest(policy: InteractiveRequestPolicyInput): boolean {
  return policy.permissionEscalation === "deny";
}
