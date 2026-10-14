// each harness's runtime and its vendor's sign-in, for Settings and `agents list`, and the
// vendor's own sign-in and sign-out. A missing runtime or a vendor that did not answer is a
// REPORTED fact, and so is a sign-in the vendor refused; only a request this server cannot run is
// refused.

import { base } from "../orpc";
import { SignInInProgressError } from "./agent-sign-in";
import { HarnessRefusedError } from "./agents-service";

type AgentRefusal = HarnessRefusedError["kind"] | "signing-in";

const refusalOf = (cause: unknown): { kind: AgentRefusal; message: string } | null => {
  if (cause instanceof HarnessRefusedError) {
    return { kind: cause.kind, message: cause.message };
  }
  if (cause instanceof SignInInProgressError) {
    return { kind: "signing-in", message: cause.message };
  }
  return null;
};

// a refusal the route's map leaves out is rethrown as it came: a 500, never a class its row does
// not declare.
const refusing = async <T>(
  work: () => T | Promise<T>,
  byKind: Partial<Record<AgentRefusal, (options: { message: string }) => Error>>,
): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    const refusal = refusalOf(error);
    const refuse = refusal === null ? undefined : byKind[refusal.kind];
    if (refusal !== null && refuse !== undefined) {
      throw refuse({ message: refusal.message });
    }
    throw error;
  }
};

const status = base.agents.status.handler(async ({ context }) => await context.agents.status());

const setDefault = base.agents.setDefault.handler(
  async ({ context, input }) => await context.agents.setDefault(input.id),
);

const signIn = base.agents.signIn.handler(
  async ({ context, input, errors }) =>
    await refusing(async () => await context.agents.signIn(input.id), {
      "signing-in": errors.CONFLICT,
      unavailable: errors.PROVIDER_UNAVAILABLE,
    }),
);

const cancelSignIn = base.agents.cancelSignIn.handler(
  async ({ context, input }) => await context.agents.cancelSignIn(input.id),
);

const signOut = base.agents.signOut.handler(
  async ({ context, input, errors }) =>
    await refusing(async () => await context.agents.signOut(input.id), {
      unavailable: errors.PROVIDER_UNAVAILABLE,
    }),
);

const submitSignInCode = base.agents.submitSignInCode.handler(
  async ({ context, input, errors }) =>
    await refusing(() => context.agents.submitSignInCode(input.id, input.code), {
      "no-code-wanted": errors.CONFLICT,
    }),
);

export const agentsRouter = {
  cancelSignIn,
  setDefault,
  signIn,
  signOut,
  status,
  submitSignInCode,
};
