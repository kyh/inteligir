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
// the token only far enough to address an object, and the OBJECT re-verifies it
// against its own name and its own state. There is no forwarded verdict to
// forge.
//
// "Only far enough to address" still means the SIGNATURE holds. Naming a
// Durable Object brings one into existence, so a name taken from unverified
// claims is a name anyone can type: a spray of userIds would leave orphan
// objects behind, each holding storage, belonging to no account and reachable
// by no purge path. Expiry and binding stay the object's to answer.
//
// The report route is the reason a turn does not pin a Durable Object. The
// container holds the turn; each thing it produces arrives here as its own
// short request; the object folds it into the transcript and broadcasts it. An
// object that instead subscribed to the container's stream would be pinned for
// the life of the turn, and a fifteen-minute outbound ceiling would end it
// mid-answer.
// ---------------------------------------------------------------------------

import { MAX_REPORT_BYTES } from "@repo/agent-container/protocol";

import { verifiedTokenAddress } from "./agent-crypto";
import { readBearer } from "../host/session";
import { userHostName } from "../host/host-address";
import { OAUTH_CALLBACK_PATH, oauthResultPage, providerRefusalMessage } from "./provider-oauth";

const REPORT_PATH = /^\/v1\/agent\/([^/]+)\/report$/;

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
  // The token has to be one this deployment signed, and its claim about who it
  // belongs to has to AGREE with the path, before an object is woken. It is
  // still not a verdict — the object re-verifies and adds the boot binding no
  // signature can carry — but a request failing either is one that was never
  // going to be served, and it must not instantiate a Durable Object on its way
  // to being told no.
  if ((await verifiedTokenAddress(env.BETTER_AUTH_SECRET, "report", token)) !== addressed) {
    return new Response("unauthorized", { status: 401 });
  }

  const bounded = await boundBody(request, MAX_REPORT_BYTES);
  if (bounded === null) return new Response("report too large", { status: 413 });
  return env.UserHost.getByName(userHostName(addressed)).fetch(bounded);
}

/**
 * The same request with a body that CANNOT exceed `limit`, or `null` when it
 * already does.
 *
 * A declared `content-length` is the fast path and the ordinary one: the
 * container posts a string, so `fetch` sets the header and the request is
 * forwarded untouched. A body with no declared length is not therefore small —
 * it is a body whose size nobody has stated, which is what a chunked one is —
 * so it is READ under the same ceiling before an object is woken. Reading it is
 * bounded by definition: the read stops at the limit, so the memory this costs
 * is the ceiling it enforces, and the caller here is a process the user's own
 * agent runs shell commands inside.
 */
async function boundBody(request: Request, limit: number): Promise<Request | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared)) {
    return Number(declared) > limit ? null : request;
  }
  const body = request.body;
  if (body === null) return request;

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes,
  });
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
  const addressed =
    state === null ? null : await verifiedTokenAddress(env.BETTER_AUTH_SECRET, "oauth", state);
  if (addressed !== null) {
    // Forwarded as a request the object can verify from scratch: the state token
    // is the credential, and it is the object that decides whether it holds.
    // Expiry included — a state that timed out on a consent screen is authentic
    // and belongs to a real object, which is the only party that can both say
    // so in words and clear the verifier the attempt parked.
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
