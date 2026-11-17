import { BASE_ERROR_CODES } from "better-auth";
import { APIError } from "better-auth/api";

import { getAuth, sessionCredential } from "./auth";

type SessionDeletion = "deleted" | "invalid-credentials" | "signed-out";

// a password Better Auth would not verify for the account; one with no password to check is no
// account a password could delete
const REFUSED_PASSWORD_CODES: ReadonlySet<string> = new Set([
  BASE_ERROR_CODES.INVALID_PASSWORD.code,
  BASE_ERROR_CODES.CREDENTIAL_ACCOUNT_NOT_FOUND.code,
]);

// `account.delete` under a session, through Better Auth's own `deleteUser` with the password in its
// body, which it checks against the account in place of the session's freshness; its beforeDelete
// runs what the account's row does not take by cascade (./auth.ts). The session is the one the
// request's credential names, whichever door it came by.
export const deleteAccountUnderSession = async (
  headers: Pick<Headers, "get">,
  password: string,
): Promise<SessionDeletion> => {
  try {
    await getAuth().api.deleteUser({ body: { password }, headers: sessionCredential(headers) });
    return "deleted";
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
};
