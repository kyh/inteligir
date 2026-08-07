// ---------------------------------------------------------------------------
// The name a user's Durable Object answers to, in one place.
//
// Across `/v1/host/*` the name is DERIVED from a credential (see ./session's
// `addressedUserId`) and never read out of a path, so a caller cannot bring an
// object into existence by naming one.
//
// The container's report route is the one exception, and it is not a hole:
// `POST /v1/agent/:userId/report` carries the id in its path because the
// container holds no session, so ../agent/agent-route.ts requires the segment
// to AGREE with the token's own claim before it names anything here.
// ---------------------------------------------------------------------------

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

/** The userId an object's own name serves, or `null` for an object addressed by
 * id (which can never authenticate, so it serves nobody). The inverse of
 * `userHostName`, kept beside it so the two cannot disagree about the prefix. */
export function userIdFromHostName(hostName: string | undefined): string | null {
  if (hostName === undefined || !hostName.startsWith(USER_HOST_PREFIX)) return null;
  const userId = hostName.slice(USER_HOST_PREFIX.length);
  return userId === "" ? null : userId;
}
