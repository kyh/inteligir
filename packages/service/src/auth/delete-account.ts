import { BASE_ERROR_CODES } from "better-auth";
import { APIError } from "better-auth/api";

import { endDeletedAccountSessions } from "../agent/deleted-account-sessions";
import type { AgentRuntime } from "../agent/runtime";
import { getAuth, sessionCredential } from "./auth";

const REFUSED_PASSWORD_CODES: ReadonlySet<string> = new Set([
  BASE_ERROR_CODES.INVALID_PASSWORD.code,
  BASE_ERROR_CODES.CREDENTIAL_ACCOUNT_NOT_FOUND.code,
]);

interface AccountDeletion {
  readonly accountId: string;
  readonly headers: Pick<Headers, "get">;
  readonly password: string;
}

export const deleteAccountUnderSession = async (
  runtime: AgentRuntime | null,
  { accountId, headers, password }: AccountDeletion,
) => {
  try {
    await getAuth().api.deleteUser({ body: { password }, headers: sessionCredential(headers) });
  } catch (error) {
    if (!(error instanceof APIError)) {
      throw error;
    }

    if (REFUSED_PASSWORD_CODES.has(error.body?.code ?? "")) {
      return "invalid-credentials" as const;
    }

    if (error.statusCode === 401) {
      return "signed-out" as const;
    }

    throw error;
  }

  await endDeletedAccountSessions(runtime, accountId);

  return "deleted" as const;
};
