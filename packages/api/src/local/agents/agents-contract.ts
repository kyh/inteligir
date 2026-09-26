import { oc } from "@orpc/contract";

import { PROVIDER_UNAVAILABLE } from "../local-errors";
import {
  agentsHarnessRequestSchema,
  agentsSignInResponseSchema,
  agentsSignOutResponseSchema,
  agentsStatusResponseSchema,
} from "./agents-schema";

// NOT_FOUND on every row that names a harness: no harness by that id; the status list is the set
// of ids
export const agentsContract = {
  // answers once the running sign-in has ended, idempotent: a sign-in already over leaves nothing
  // to cancel
  cancelSignIn: oc
    .input(agentsHarnessRequestSchema)
    .output(agentsStatusResponseSchema)
    .errors({ NOT_FOUND: {} }),

  setDefault: oc
    .input(agentsHarnessRequestSchema)
    .output(agentsStatusResponseSchema)
    .errors({ NOT_FOUND: {} }),

  // held open until the vendor's sign-in ends, up to its ceiling. CONFLICT: another sign-in is
  // running on this server; PROVIDER_UNAVAILABLE: this copy of the app is missing that runtime. A
  // sign-in the vendor refused is a `failed` outcome, never a refusal
  signIn: oc
    .input(agentsHarnessRequestSchema)
    .output(agentsSignInResponseSchema)
    .errors({ CONFLICT: {}, NOT_FOUND: {}, PROVIDER_UNAVAILABLE }),

  signOut: oc
    .input(agentsHarnessRequestSchema)
    .output(agentsSignOutResponseSchema)
    .errors({ NOT_FOUND: {}, PROVIDER_UNAVAILABLE }),

  status: oc.output(agentsStatusResponseSchema),
};
