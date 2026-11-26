import { APIError } from "better-auth/api";
import { applySetCookies } from "better-auth/cookies";

import { endDeletedAccountSessions } from "../agent/deleted-account-sessions";
import type { AgentRuntime } from "../agent/runtime";
import { getAuth, readSession } from "./auth";

interface AccountDeletion {
  readonly accountId: string;
  readonly headers: Pick<Headers, "get">;
  readonly code: string;
}

const freshSessionOf = async (email: string, code: string) => {
  try {
    const { headers } = await getAuth().api.signInEmailOTP({
      body: { email, otp: code },
      returnHeaders: true,
    });

    const fresh = new Headers();
    applySetCookies(fresh, headers.getSetCookie());

    return fresh satisfies Headers;
  } catch (error) {
    if (error instanceof APIError && error.statusCode < 500) {
      return null;
    }

    throw error;
  }
};

export const deleteAccountUnderSession = async (
  runtime: AgentRuntime | null,
  { accountId, code, headers }: AccountDeletion,
) => {
  const signedIn = await readSession(headers);

  if (signedIn?.user.id !== accountId) {
    return "signed-out" as const;
  }

  const fresh = await freshSessionOf(signedIn.user.email, code);

  if (fresh === null) {
    return "invalid-credentials" as const;
  }

  await getAuth().api.deleteUser({ body: {}, headers: fresh });
  await endDeletedAccountSessions(runtime, accountId);

  return "deleted" as const;
};
