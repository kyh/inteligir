// ---------------------------------------------------------------------------
// Capability classes — what a connected client may invoke and receive.
//
// The node host had a privileged peer: the loopback renderer authenticated
// with a per-boot token, was exempt from every gate, and reached all 95 host
// methods; a paired phone reached the five REMOTE_ALLOWED_METHODS and three
// REMOTE_ALLOWED_EVENTS. In the cloud there is no loopback — every client is
// remote, over the same socket, against the same Durable Object — so the
// exemption has to become a CLASS that is decided server-side.
//
// A class is a property of HOW a socket authenticated, never of anything the
// socket says about itself. There is exactly one credential today, so there is
// exactly one producer of a class (`SESSION_CLIENT_CLASS`), and a client has
// no field anywhere on the wire that influences it.
// ---------------------------------------------------------------------------

import { REMOTE_ALLOWED_EVENTS, REMOTE_ALLOWED_METHODS } from "@repo/bridge/ipc-registry";

/**
 * `web` is the full workspace UI — the surface that replaces the desktop
 * renderer. `mobile` is the companion: chat plus the delegation dock, the same
 * narrow set a paired phone reached over the node transport.
 */
export type ClientClass = "web" | "mobile";

/**
 * The class a Better Auth session admits to.
 *
 * DELIBERATE, and the single decision this module exists to make: `web` is
 * blanket-granted the whole host surface rather than an allowlist of its own.
 * That re-exposes `transition` (whose RESET_APP_DATA event wipes app state),
 * `connectAiProvider`, `setVoiceApiKey` and every other admin-plane channel to
 * anything holding this user's session.
 *
 * It is defensible only because of the tenancy: one Durable Object per user,
 * every handler scoped to that object's own storage, and a session that
 * already implies full control of the account those handlers act on. An
 * allowlist between a user's session and a user's own state would be
 * theatre — it protects nothing the session does not already own.
 *
 * What would change the calculus is a capability that reaches OUTSIDE the
 * tenancy or spends money on the user's behalf (a shared vault, a billed model
 * call an unattended surface can trigger). The moment one lands, it needs its
 * own class rather than a quiet arrival inside this grant — which is the whole
 * risk of a blanket grant, and why it is written down here instead of inferred
 * from the absence of a list.
 */
export const SESSION_CLIENT_CLASS: ClientClass = "web";

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
