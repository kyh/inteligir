// ---------------------------------------------------------------------------
// Capability classes — what a connected client may invoke and receive.
//
// Every client is remote here: same socket, same Durable Object, same account.
// So the workspace's reach cannot be a property of where it connected from; it
// has to be a CLASS decided server-side, and decided from something a caller
// cannot simply assert.
//
// The discriminator is WHICH CREDENTIAL carried the session, never a header a
// caller sets for free:
//
//   • a session COOKIE, from an allowlisted Origin → `web`. A cookie cannot be
//     read or set by a cross-site page, and the Origin corroborates that a
//     browser attached it rather than a script replaying a stolen one.
//   • a BEARER token, with no browser Origin at all → `mobile`. The token is
//     the credential; the absent Origin only has to AGREE with it.
//
// Both remaining combinations refuse. A bearer arriving with an Origin is a
// non-browser reaching for the browser class, and a cookie arriving without one
// is a cookie no browser attached — neither is a client, and admitting either
// would make the class an assertion again.
// ---------------------------------------------------------------------------

import { REMOTE_ALLOWED_EVENTS, REMOTE_ALLOWED_METHODS } from "@repo/bridge/ipc-registry";

import { originAllowed } from "./origins";
import type { HostCredential } from "./session";

/**
 * `web` is the full workspace UI. `mobile` is the companion: chat plus the
 * delegation dock, the narrow set `REMOTE_ALLOWED_*` names.
 */
export type ClientClass = "web" | "mobile";

/**
 * The class this credential admits to, or `null` to refuse the request whole.
 *
 * DELIBERATE, and the decision this module exists to make: `web` is
 * blanket-granted the whole host surface rather than an allowlist of its own.
 * That exposes `transition` (whose RESET_APP_DATA event wipes app state),
 * `connectAiProvider`, `setVoiceApiKey` and every other admin-plane channel to
 * anything holding this user's session cookie.
 *
 * It is defensible only because of the tenancy: one Durable Object per user,
 * every handler scoped to that object's own storage, and a session that already
 * implies full control of the account those handlers act on. An allowlist
 * between a user's session and a user's own state would be theatre — it
 * protects nothing the session does not already own.
 *
 * What would change the calculus is a capability that reaches OUTSIDE the
 * tenancy or spends money on the user's behalf (a shared vault, a billed model
 * call an unattended surface can trigger). The moment one lands it needs its
 * own class rather than a quiet arrival inside this grant — which is the whole
 * risk of a blanket grant, and why it is written down here instead of inferred
 * from the absence of a list.
 */
export function clientClassFor(
  credential: HostCredential,
  origin: string | null,
  allowed: ReadonlySet<string>,
): ClientClass | null {
  if (credential.kind === "cookie") return originAllowed(origin, allowed) ? "web" : null;
  return origin === null ? "mobile" : null;
}

const MOBILE_METHODS = new Set<string>(REMOTE_ALLOWED_METHODS);
const MOBILE_EVENTS = new Set<string>(REMOTE_ALLOWED_EVENTS);

/** Whether `clientClass` may invoke `method`. Fails CLOSED for `mobile`: a
 * channel added to the registry is unreachable from the companion until it is
 * allowlisted on purpose. */
export function mayInvoke(clientClass: ClientClass, method: string): boolean {
  return clientClass === "web" || MOBILE_METHODS.has(method);
}

/** Whether `clientClass` may receive `event` — at broadcast AND at hydration. */
export function mayReceive(clientClass: ClientClass, event: string): boolean {
  return clientClass === "web" || MOBILE_EVENTS.has(event);
}
