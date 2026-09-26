// each harness's runtime and its vendor's sign-in, for Settings and `agents list`, and the
// vendor's own sign-in and sign-out. A missing runtime or a vendor that did not answer is a
// REPORTED fact, and so is a sign-in the vendor refused; only a request this server cannot run is
// refused.

import { ORPCError } from "@orpc/server";
import { base, refusals } from "../orpc";
import { SignInInProgressError } from "./agent-sign-in";
import { HarnessRefusedError } from "./agents-service";

const HARNESS_REFUSALS = {
  "no-code-wanted": "CONFLICT",
  "not-found": "NOT_FOUND",
  unavailable: "PROVIDER_UNAVAILABLE",
} as const satisfies Record<HarnessRefusedError["kind"], string>;

const refusing = refusals((cause) => {
  if (cause instanceof HarnessRefusedError) {
    return new ORPCError(HARNESS_REFUSALS[cause.kind], { message: cause.message });
  }
  if (cause instanceof SignInInProgressError) {
    return new ORPCError("CONFLICT", { message: cause.message });
  }
  return null;
});

const status = base.agents.status.handler(async ({ context }) => await context.agents.status());

const setDefault = base.agents.setDefault.handler(
  async ({ context, input }) =>
    await refusing(async () => await context.agents.setDefault(input.id)),
);

const signIn = base.agents.signIn.handler(
  async ({ context, input }) => await refusing(async () => await context.agents.signIn(input.id)),
);

const cancelSignIn = base.agents.cancelSignIn.handler(
  async ({ context, input }) =>
    await refusing(async () => await context.agents.cancelSignIn(input.id)),
);

const signOut = base.agents.signOut.handler(
  async ({ context, input }) => await refusing(async () => await context.agents.signOut(input.id)),
);

const submitSignInCode = base.agents.submitSignInCode.handler(
  async ({ context, input }) =>
    await refusing(() => context.agents.submitSignInCode(input.id, input.code)),
);

export const agentsRouter = {
  cancelSignIn,
  setDefault,
  signIn,
  signOut,
  status,
  submitSignInCode,
};
