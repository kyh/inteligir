// ---------------------------------------------------------------------------
// `POST /v1/host/:userId/link` — the web scheme's front door.
//
// A capture WRITES to the user's vault, so it is authenticated exactly like the
// asset upload: the Worker half ADDRESSES the object, the object half VERIFIES
// the bearer against its own name. There is no forwarded verdict to forge, and
// naming another user's host reaches an object that refuses.
//
// It is a POST rather than the `GET /capture?…` a link would navigate to, and
// that is the deliberate half of the design: a GET a page can cause is a CSRF
// write, and the desktop's equivalent guard was that the OS handed the URL to a
// process holding the user's own vault. The navigable page is a CLIENT surface
// — it reads the query, and it calls this with the user's bearer.
// ---------------------------------------------------------------------------

import { mayInvoke, SESSION_CLIENT_CLASS } from "../host/client-class";
import { userHostName } from "../host/host-address";
import { allowedOrigins, originAllowed } from "../host/origins";
import { readBearer, verifyHostSession } from "../host/session";
import type { CaptureService } from "./capture-service";
import { matchDeepLinkPath, parseWebDeepLink } from "./deep-link";

/** Largest link body accepted. The grammar's own cap is 16 KiB of URL; this is
 * the transport's restatement of it, so an oversize body is refused before it
 * is read rather than after. */
const MAX_LINK_BYTES = 32 * 1024;

/** Answer a deep link, or `null` when this request is not one. */
export async function routeDeepLink(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  const userId = matchDeepLinkPath(request.method, pathname);
  if (userId === null) return null;
  if (!originAllowed(request.headers.get("origin"), allowedOrigins(env))) {
    return new Response("origin not allowed", { status: 403 });
  }
  return env.UserHost.getByName(userHostName(userId)).fetch(request);
}

/**
 * The object's half: verify the bearer, parse the link through the pure
 * grammar, and act on it.
 *
 * The verb and its parameters ride in the QUERY, not the body, so the shape a
 * client sends is the shape it received — a page that got `?text=…` forwards
 * it rather than re-encoding it into something the parser has never seen.
 */
export async function handleDeepLink(
  request: Request,
  env: Env,
  service: CaptureService,
  hostName: string | undefined,
): Promise<Response> {
  const token = readBearer(request.headers);
  if (token === null) return new Response("unauthorized", { status: 401 });
  const url = new URL(request.url);
  const session = await verifyHostSession(env, url.origin, token, hostName);
  if (session === null) return new Response("unauthorized", { status: 401 });
  // Gated on the CAPABILITY, not on being an HTTP route: a client class that
  // may not ack a capture must not be able to create one here either.
  if (!mayInvoke(SESSION_CLIENT_CLASS, "ackCapture")) {
    return new Response("forbidden", { status: 403 });
  }
  if (url.href.length > MAX_LINK_BYTES) return new Response("link too large", { status: 413 });

  const verb = url.searchParams.get("verb");
  if (verb === null) return new Response("missing verb", { status: 400 });
  const action = parseWebDeepLink(verb, url.searchParams);
  if (action === null) return new Response("unsupported link", { status: 400 });
  const delivered = service.deliver(action);
  if (delivered === null) return new Response("unsupported link", { status: 400 });
  return Response.json(delivered);
}
