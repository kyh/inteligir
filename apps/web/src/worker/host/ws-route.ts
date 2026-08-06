// ---------------------------------------------------------------------------
// The Worker-side leg of the workspace's Bridge socket: check the Origin, then
// address the user's Durable Object.
//
// The refusal happens HERE, before `getByName`, for the same reason the vault
// surface refuses a malformed vaultId there: a request that is never going to
// be served should not bring a Durable Object into existence on its way to
// being told no.
//
// The userId in the path is an ADDRESS, not a credential — nothing here
// authenticates. The object it names re-derives the truth from the session the
// socket presents in its first frame and refuses a name that does not match
// it, which is the same split the vault routes use (the Worker addresses, the
// object verifies) and the reason no forwarded verdict exists to forge.
// ---------------------------------------------------------------------------

import { matchHostPath, userHostName } from "./host-address";
import { allowedOrigins, originAllowed } from "./origins";

/** The userId a `GET /v1/host/:userId/ws` addresses, or `null` when `pathname`
 * is not one. Pure — no bindings, no I/O. */
export function matchHostSocketPath(method: string, pathname: string): string | null {
  return method === "GET" ? matchHostPath(pathname, "ws") : null;
}

/** Answer the host-socket upgrade, or `null` when this request is not one. */
export async function routeHostSocket(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  const userId = matchHostSocketPath(request.method, pathname);
  if (userId === null) return null;
  if (!originAllowed(request.headers.get("origin"), allowedOrigins(env))) {
    return new Response("origin not allowed", { status: 403 });
  }
  return env.UserHost.getByName(userHostName(userId)).fetch(request);
}
