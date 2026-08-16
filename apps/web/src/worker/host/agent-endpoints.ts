// ---------------------------------------------------------------------------
// The object's half of the two agent routes — where the token is VERIFIED.
//
// The Worker half (../agent/agent-route) only addressed an object. Everything
// that decides anything happens here, against this object's own name and its
// own state, so there is no forwarded verdict to forge. That is the same split
// the socket and the asset upload use, and the reason it is repeated rather
// than shortened is that both callers are unauthenticated in the session sense:
// the container has no user session, and the OAuth callback is a redirect the
// provider issues to a browser.
// ---------------------------------------------------------------------------

import type { AgentRunner } from "../agent/agent-runner";
import { oauthResultPage, providerRefusalMessage } from "../agent/provider-oauth";
import type { PendingAuthorization, ProviderCredentials } from "../agent/provider-credentials";
import { verifyScopedToken } from "../agent/agent-crypto";
import { readBearer } from "./session";

/**
 * Answer one container report.
 *
 * HTTP and nothing else: the bearer off the header, the body as text, and the
 * sink's answer mapped onto a status. Every decision — is this bearer one of
 * this object's containers, which LANE is it, is this body a report at all —
 * belongs to `acceptReport`, because the scripted container reaches the same
 * entry without an HTTP hop and a decision made here would be one it skipped.
 */
export async function handleAgentReport(request: Request, runner: AgentRunner): Promise<Response> {
  const token = readBearer(request.headers);
  // Refused before the body is read: a caller with no bearer has nothing to say
  // and must not cost this object a body.
  if (token === null) return new Response("unauthorized", { status: 401 });
  const answer = await runner.acceptReport(token, await request.text());
  return answer.ok
    ? Response.json(answer.reply)
    : new Response(answer.error, { status: answer.status });
}

/**
 * Complete a provider OAuth round-trip.
 *
 * The `state` is the credential and this is where it is checked: signed by this
 * deployment, scoped to OAuth, naming this object's user, and matching the
 * nonce parked when the authorization started. The pending record is consumed
 * on read, so a replayed callback finds nothing.
 *
 * A REFUSAL arrives here too, rather than being answered by the Worker that
 * addressed this object. Only this object can verify the state and clear the
 * verifier the attempt parked — and only this object can tell the workspace,
 * which is in another tab holding a "waiting" state that nothing else would
 * ever end. So every outcome that spent the pending record calls `onSettled`,
 * and the workspace reads the truth off the snapshot that follows.
 */
export async function handleOAuthCallback(
  request: Request,
  env: Env,
  credentials: ProviderCredentials,
  onSettled: () => void,
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (state === null) {
    return oauthResultPage("That sign-in link is missing something.", false);
  }
  const claims = await verifyScopedToken(env.BETTER_AUTH_SECRET, "oauth", state, Date.now());
  if (claims === null) {
    return oauthResultPage("That sign-in link has expired. Try connecting again.", false);
  }
  const pending = credentials.takePending(claims.ref);
  if (pending === null) {
    return oauthResultPage("That sign-in was already completed, or has expired.", false);
  }

  const outcome = await settleAuthorization(url, credentials, pending);
  onSettled();
  return oauthResultPage(outcome.message, outcome.ok);
}

/** What the redirect's parameters amount to, once the pending record is spent.
 * Split out so the caller settles the client exactly once, on every path. */
async function settleAuthorization(
  url: URL,
  credentials: ProviderCredentials,
  pending: PendingAuthorization,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  const refused = url.searchParams.get("error");
  if (refused !== null) return { ok: false, message: providerRefusalMessage(refused) };
  const code = url.searchParams.get("code");
  if (code === null) {
    return { ok: false, message: "The provider sent no authorization code back." };
  }
  const completed = await credentials.completeAuthorization(pending, code);
  if (!completed.ok) return { ok: false, message: completed.error };
  return { ok: true, message: "You can close this tab and go back to Inteligir." };
}
