import { BASE_ERROR_CODES } from "better-auth";
import { APIError } from "better-auth/api";

import { createAuth, sessionCredential } from "./auth";

type SessionDeletion = "deleted" | "invalid-credentials" | "signed-out";

// a password Better Auth would not verify for the account; one with no password to check is no
// account a password could delete
const REFUSED_PASSWORD_CODES: ReadonlySet<string> = new Set([
  BASE_ERROR_CODES.INVALID_PASSWORD.code,
  BASE_ERROR_CODES.CREDENTIAL_ACCOUNT_NOT_FOUND.code,
]);

// `account.delete` under a session, through Better Auth's own `deleteUser` with the password in
// its body, which it checks against the account in place of the session's freshness; its
// beforeDelete runs the account's one purge (./auth.ts). The session is the one the request's
// credential names, whichever door it came by
export const deleteAccountUnderSession = async (
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  password: string,
): Promise<SessionDeletion> => {
  try {
    await createAuth(env, ctx, new URL(request.url).origin).api.deleteUser({
      body: { password },
      headers: sessionCredential(request),
    });
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
