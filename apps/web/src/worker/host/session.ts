// ---------------------------------------------------------------------------
// The one way a caller becomes a session on a UserHost.
//
// A caller presents exactly ONE credential — a bearer token or a session
// cookie — and it is the only thing session resolution ever sees. Building the
// headers here rather than forwarding the request's own is what keeps that
// true: a request carries an Origin, a Host and whatever else a client felt
// like sending, and none of it may reach the decision about who this is.
//
// Two conditions, both required, for every transport that names an object:
// Better Auth accepts the credential, AND the session's user is the one this
// object serves. The second is what makes the object name a mere address —
// reaching another user's host reaches an object that refuses.
//
// Shared because every entry point must reach the SAME verdict. Two copies of
// a two-condition check is how one of them ends up with one condition.
// ---------------------------------------------------------------------------

import { createAuth } from "../auth/auth";
import { userHostName } from "./host-address";

export type HostSession = { readonly userId: string; readonly sessionId: string };

/**
 * The credential a caller presented.
 *
 * A closed union rather than a pair of optional fields: "both" and "neither"
 * are not states any caller may be in, and the class a ticket is minted for is
 * decided from WHICH of these arrived (see ./client-class).
 */
export type HostCredential =
  | { readonly kind: "bearer"; readonly token: string }
  | { readonly kind: "cookie"; readonly cookie: string };

/**
 * The credential on a request, or `null` when it carries none.
 *
 * A bearer WINS over a cookie when both are present, and that ordering is
 * load-bearing: the class rules refuse a bearer that arrives with a browser
 * Origin, so a native caller cannot reach the browser class by also sending a
 * cookie it happens to hold.
 */
export function readCredential(headers: Headers): HostCredential | null {
  const token = readBearer(headers);
  if (token !== null) return { kind: "bearer", token };
  const cookie = headers.get("cookie");
  return cookie === null || cookie === "" ? null : { kind: "cookie", cookie };
}

/** The bearer token on a request, or `null` when there is no bearer at all. */
export function readBearer(headers: Headers): string | null {
  const raw = headers.get("authorization");
  if (raw === null) return null;
  const match = /^Bearer (.+)$/i.exec(raw.trim());
  return match?.[1] ?? null;
}

/**
 * The user `credential` names, with no object in the picture.
 *
 * This is what the Worker addresses with: an object name is DERIVED from a
 * credential rather than taken from a path, so a caller who holds no session
 * cannot bring any Durable Object into existence, and one who does can only
 * ever reach their own.
 */
export async function addressedUserId(
  env: Env,
  baseUrl: string,
  credential: HostCredential,
): Promise<string | null> {
  const session = await resolveSession(env, baseUrl, credential);
  return session?.userId ?? null;
}

/**
 * Resolve `credential` against the object named `hostName`, or `null` to
 * refuse. `hostName` is `ctx.id.name`, which is `undefined` for an object
 * addressed by id — and an object nobody can name is an object no session can
 * bind to, so that refuses too rather than being special-cased.
 */
export async function verifyHostSession(
  env: Env,
  baseUrl: string,
  credential: HostCredential,
  hostName: string | undefined,
): Promise<HostSession | null> {
  const session = await resolveSession(env, baseUrl, credential);
  if (session === null) return null;
  return hostName === userHostName(session.userId) ? session : null;
}

async function resolveSession(
  env: Env,
  baseUrl: string,
  credential: HostCredential,
): Promise<HostSession | null> {
  const auth = createAuth(env, baseUrl);
  const result = await auth.api.getSession({ headers: credentialHeaders(credential) });
  if (result === null) return null;
  return { userId: result.user.id, sessionId: result.session.id };
}

function credentialHeaders(credential: HostCredential): Headers {
  return credential.kind === "bearer"
    ? new Headers({ authorization: `Bearer ${credential.token}` })
    : new Headers({ cookie: credential.cookie });
}
