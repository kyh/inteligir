// ---------------------------------------------------------------------------
// The one way a caller becomes a session on a UserHost.
//
// Two conditions, both required, for every transport: Better Auth accepts the
// bearer, AND the session's user is the one this object serves. The second is
// what makes the userId in the URL a mere address — naming another user's host
// reaches an object that refuses.
//
// Shared because the socket's first frame and the asset upload's Authorization
// header must reach the SAME verdict. Two copies of a two-condition check is
// how one of them ends up with one condition.
// ---------------------------------------------------------------------------

import { createAuth } from "../auth/auth";
import { userHostName } from "./host-address";

export type HostSession = { readonly userId: string; readonly sessionId: string };

/**
 * Resolve `token` against the object named `hostName`, or `null` to refuse.
 * `hostName` is `ctx.id.name`, which is `undefined` for an object addressed by
 * id — and an object nobody can name is an object no session can bind to, so
 * that refuses too rather than being special-cased.
 */
export async function verifyHostSession(
  env: Env,
  baseUrl: string,
  token: string,
  hostName: string | undefined,
): Promise<HostSession | null> {
  const auth = createAuth(env, baseUrl);
  const result = await auth.api.getSession({
    headers: new Headers({ authorization: `Bearer ${token}` }),
  });
  if (result === null) return null;
  if (hostName !== userHostName(result.user.id)) return null;
  return { userId: result.user.id, sessionId: result.session.id };
}

/** The bearer token on a request, or `null` when there is no bearer at all. */
export function readBearer(headers: Headers): string | null {
  const raw = headers.get("authorization");
  if (raw === null) return null;
  const match = /^Bearer (.+)$/i.exec(raw.trim());
  return match?.[1] ?? null;
}
