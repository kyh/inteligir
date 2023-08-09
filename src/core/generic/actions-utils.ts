import getSupabaseServerActionClient from "~/core/supabase/action-client";
import verifyCsrfToken from "~/core/verify-csrf-token";
import requireSession from "~/lib/user/require-session";

export function withCsrfCheck<
  Params extends {
    csrfToken: string;
  },
  Return extends unknown,
>(fn: (params: Params) => Return) {
  return async (params: Params) => {
    await verifyCsrfToken(params.csrfToken);

    return fn(params);
  };
}

export function withSession<Args extends any[]>(
  fn: (...params: Args) => unknown,
) {
  return async (...params: Args) => {
    const client = getSupabaseServerActionClient();

    await requireSession(client);

    return fn(...params);
  };
}
