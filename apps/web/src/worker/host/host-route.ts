// ---------------------------------------------------------------------------
// `/v1/host/*` — the Worker's one leg in front of every UserHost route.
//
// THERE IS NO userId IN THE PATH. The object name is derived from the
// credential the request carries (./session's `addressedUserId`), so a caller
// holding no session cannot bring a Durable Object into existence by naming
// one, and a caller holding one can only ever address their own. That closes
// the residual the addressed-by-path shape left behind: an object with two
// unwritten KV keys per userId anyone cared to type.
//
// The Worker still ADDRESSES and the object still VERIFIES. Nothing is
// forwarded but the request itself — no verdict, no resolved id, no header this
// leg wrote — so the object re-derives the truth from the same credential (or,
// for the socket, from a ticket only it could have minted) and refuses anything
// that does not bind to its own name.
//
// One leg for four leaves, because the alternative is four copies of the same
// six lines and one of them eventually skips the check the others make.
// ---------------------------------------------------------------------------

import { userHostName } from "./host-address";
import { addressedUserId, readCredential } from "./session";

/**
 * The leaves this surface serves, each with the ONE method it answers.
 *
 * Declared as data so the Worker's routing and the object's dispatch read the
 * same table — a leaf the object handles but the Worker never forwards is a
 * capability nobody can reach, and the reverse is a request nobody answers.
 */
const HOST_LEAVES = {
  /** Mint the single-use ticket a socket authenticates with. */
  ticket: "POST",
  /** The Bridge socket itself. */
  ws: "GET",
  /** Attachment bytes, streamed off the socket. */
  assets: "POST",
  /** The web scheme's front door. */
  link: "POST",
} as const;

export type HostLeaf = keyof typeof HOST_LEAVES;

const HOST_PATH = /^\/v1\/host\/([a-z]+)$/;

/** The leaf a `/v1/host/<leaf>` request names, or `null` when it names none.
 * Pure — no bindings, no I/O, and the object's own dispatch reads it too. */
export function matchHostLeaf(method: string, pathname: string): HostLeaf | null {
  const leaf = HOST_PATH.exec(pathname)?.[1];
  if (leaf === undefined || !isHostLeaf(leaf)) return null;
  return HOST_LEAVES[leaf] === method ? leaf : null;
}

/** Answer a host route, or `null` when this request is not one. */
export async function routeHost(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  if (matchHostLeaf(request.method, pathname) === null) return null;
  const credential = readCredential(request.headers);
  if (credential === null) return new Response("unauthorized", { status: 401 });
  // The one session resolution this leg does, and it buys only an address. The
  // object pays for its own verdict — on the socket that is a local ticket
  // read rather than a second round trip, which is what keeps a hibernation
  // wake cheap.
  const userId = await addressedUserId(env, new URL(request.url).origin, credential);
  if (userId === null) return new Response("unauthorized", { status: 401 });
  return env.UserHost.getByName(userHostName(userId)).fetch(request);
}

function isHostLeaf(leaf: string): leaf is HostLeaf {
  return Object.hasOwn(HOST_LEAVES, leaf);
}
