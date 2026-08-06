// ---------------------------------------------------------------------------
// The `/v1/host/:userId/<leaf>` addressing shape, in one place.
//
// Two routes reach a UserHost — the Bridge socket and the asset upload — and
// they must agree on what a userId segment is, because the object they address
// re-derives the truth from the credential and refuses a name that does not
// match it. A second, subtly different parser here would mean a path one route
// reads as `a/b` and the other as `a%2Fb`, addressing two different objects for
// the same user.
//
// The userId is an ADDRESS, never a credential. Nothing in this module
// authenticates anything.
// ---------------------------------------------------------------------------

const HOST_PATH = /^\/v1\/host\/([^/]+)\/([^/]+)$/;

/** Namespace prefix for the object name. The Durable Object namespace is
 * already the host class's own, so the prefix buys legibility in logs rather
 * than isolation. */
const USER_HOST_PREFIX = "user:";

/** The object name serving `userId` — the one place the addressing scheme is
 * spelled, shared by the routes that dial it and the bind check that proves a
 * caller reached the right one. */
export function userHostName(userId: string): string {
  return `${USER_HOST_PREFIX}${userId}`;
}

/** The userId a `/v1/host/:userId/<leaf>` path addresses, or `null` when
 * `pathname` is not one of this leaf's. */
export function matchHostPath(pathname: string, leaf: string): string | null {
  const match = HOST_PATH.exec(pathname);
  if (match === null || match[2] !== leaf) return null;
  const raw = match[1];
  if (raw === undefined) return null;
  let userId: string;
  try {
    userId = decodeURIComponent(raw);
  } catch {
    return null; // malformed percent-encoding in the id segment
  }
  return userId === "" ? null : userId;
}
