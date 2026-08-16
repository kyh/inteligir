// ---------------------------------------------------------------------------
// `POST /v1/host/link` — the web scheme's front door.
//
// A capture WRITES to the user's vault, so it is authenticated exactly like the
// asset upload: the Worker half ADDRESSES the object from the credential, the
// object half VERIFIES that credential against its own name.
//
// It is a POST rather than the `GET /capture?…` a link would navigate to, and
// that is the deliberate half of the design: a GET a page can cause is a CSRF
// write. The navigable page is a CLIENT surface — it reads the query, and it
// calls this from the origin the user is already signed in on.
// ---------------------------------------------------------------------------

import { clientClassFor, mayInvoke } from "../host/client-class";
import { allowedOrigins } from "../host/origins";
import { readCredential, verifyHostSession } from "../host/session";
import type { CaptureService } from "./capture-service";
import { parseWebDeepLink } from "./deep-link";

/** Largest link body accepted. The grammar's own cap is 16 KiB of URL; this is
 * the transport's restatement of it, so an oversize body is refused before it
 * is read rather than after. */
const MAX_LINK_BYTES = 32 * 1024;

/**
 * The object's half: verify the credential, parse the link through the pure
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
  const credential = readCredential(request.headers);
  if (credential === null) return new Response("unauthorized", { status: 401 });
  const url = new URL(request.url);
  const session = await verifyHostSession(env, url.origin, credential, hostName);
  if (session === null) return new Response("unauthorized", { status: 401 });
  // Gated on the CAPABILITY, not on being an HTTP route: a client class that
  // may not ack a capture must not be able to create one here either.
  const clientClass = clientClassFor(
    credential,
    request.headers.get("origin"),
    allowedOrigins(env),
  );
  if (clientClass === null || !mayInvoke(clientClass, "ackCapture")) {
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
