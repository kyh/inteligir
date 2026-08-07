// ---------------------------------------------------------------------------
// The two Worker routes the agent needs that are not Bridge channels.
//
//   POST /v1/agent/:userId/report   — everything the container says.
//   GET  /v1/ai/oauth/callback      — where a provider redirects the browser.
//
// Both are UNAUTHENTICATED in the session sense and neither can be otherwise:
// the container has no user session, and the OAuth callback is a redirect the
// provider issues to a browser. So both carry a token this Worker minted, and
// both follow the same split every other host route follows — the WORKER reads
// the token only far enough to address an object, and the OBJECT verifies the
// signature against its own name. There is no forwarded verdict to forge.
//
// The report route is the reason a turn does not pin a Durable Object. The
// container holds the turn; each thing it produces arrives here as its own
// short request; the object folds it into the transcript and broadcasts it. An
// object that instead subscribed to the container's stream would be pinned for
// the life of the turn, and a fifteen-minute outbound ceiling would end it
// mid-answer.
// ---------------------------------------------------------------------------

import { tokenAddress } from "./agent-crypto";
import { readBearer } from "../host/session";
import { userHostName } from "../host/host-address";
import { OAUTH_CALLBACK_PATH, oauthResultPage, providerRefusalMessage } from "./provider-oauth";

const REPORT_PATH = /^\/v1\/agent\/([^/]+)\/report$/;

/** Largest report body accepted. Events batch and vault ops carry bytes, so
 * this is generous — but a container is a process the user's own agent runs
 * commands inside, and an unbounded body from one is a Durable Object's memory. */
const MAX_REPORT_BYTES = 8 * 1024 * 1024;

/** The userId a `POST /v1/agent/:userId/report` addresses, or `null`. Pure — no
 * bindings, no I/O. */
export function matchAgentReportPath(method: string, pathname: string): string | null {
  if (method !== "POST") return null;
  const match = REPORT_PATH.exec(pathname);
  const raw = match?.[1];
  if (raw === undefined) return null;
  try {
    const userId = decodeURIComponent(raw);
    return userId === "" ? null : userId;
  } catch {
    return null;
  }
}

/** Answer a container report, or `null` when this request is not one. */
export async function routeAgentReport(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  const addressed = matchAgentReportPath(request.method, pathname);
  if (addressed === null) return null;

  const token = readBearer(request.headers);
  if (token === null) return new Response("unauthorized", { status: 401 });
  // The token's own claim about who it belongs to has to AGREE with the path
  // before an object is woken. It is still not a verdict — the object it
  // reaches re-verifies the signature — but a mismatch here is a request that
  // was never going to be served, and one that must not instantiate a Durable
  // Object on its way to being told no.
  if (tokenAddress(token) !== addressed) return new Response("unauthorized", { status: 401 });

  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_REPORT_BYTES) {
    return new Response("report too large", { status: 413 });
  }
  return env.UserHost.getByName(userHostName(addressed)).fetch(request);
}

/**
 * Answer the provider OAuth redirect, or `null` when this request is not one.
 *
 * A REFUSAL is forwarded like a grant. Answering it here would be quicker and
 * would leave the object holding a dead verifier and the workspace holding a
 * "waiting" state nothing ever ends — the object is the only party that can
 * clear either, so the only decision this route makes is which object.
 */
export async function routeOAuthCallback(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  if (request.method !== "GET" || pathname !== OAUTH_CALLBACK_PATH) return null;
  const url = new URL(request.url);

  const state = url.searchParams.get("state");
  const addressed = state === null ? null : tokenAddress(state);
  if (addressed !== null) {
    // Forwarded as a request the object can verify from scratch: the state token
    // is the credential, and it is the object that decides whether it holds.
    return env.UserHost.getByName(userHostName(addressed)).fetch(request);
  }
  // Nothing to address, so nothing to clear. A refusal that lost its state is
  // still worth naming; anything else is a link this app did not issue.
  const refused = url.searchParams.get("error");
  return oauthResultPage(
    refused === null
      ? "That sign-in link was not issued by this app."
      : providerRefusalMessage(refused),
    false,
  );
}

/** Whether `pathname` is the OAuth callback, for the object's own routing. */
export function isOAuthCallbackPath(pathname: string): boolean {
  return pathname === OAUTH_CALLBACK_PATH;
}
