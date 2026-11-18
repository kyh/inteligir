import { BASE_ERROR_CODES } from "better-auth";
import { APIError } from "better-auth/api";

import { endDeletedAccountSessions } from "../agent/deleted-account-sessions";
import type { AgentRuntime } from "../agent/runtime";
import { getAuth, sessionCredential } from "./auth";

type SessionDeletion = "deleted" | "invalid-credentials" | "signed-out";

// a password Better Auth would not verify for the account; one with no password to check is no
// account a password could delete
const REFUSED_PASSWORD_CODES: ReadonlySet<string> = new Set([
  BASE_ERROR_CODES.INVALID_PASSWORD.code,
  BASE_ERROR_CODES.CREDENTIAL_ACCOUNT_NOT_FOUND.code,
]);

interface AccountDeletion {
  // the account the request's session holds, and the credential that names that session
  readonly accountId: string;
  readonly headers: Pick<Headers, "get">;
  readonly password: string;
}

// `account.delete` under a session, through Better Auth's own `deleteUser` with the password in its
// body, which it checks against the account in place of the session's freshness; its beforeDelete
// runs what the account's row does not take by cascade (./auth.ts), keeping the agent's sessions,
// which are ended once the account is gone. The session is the one the request's credential
// names, whichever door it came by.
export const deleteAccountUnderSession = async (
  runtime: AgentRuntime | null,
  { accountId, headers, password }: AccountDeletion,
): Promise<SessionDeletion> => {
  try {
    await getAuth().api.deleteUser({ body: { password }, headers: sessionCredential(headers) });
  } catch (error) {
    if (!(error instanceof APIError)) {
      throw error;
    }
    if (REFUSED_PASSWORD_CODES.has(error.body?.code ?? "")) {
      return "invalid-credentials";
    }
    // the session ended between the call's verification and the deletion
    if (error.statusCode === 401) {
      return "signed-out";
    }
    throw error;
  }
  await endDeletedAccountSessions(runtime, accountId);
  return "deleted";
};
