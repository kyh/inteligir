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
//
// The report body is SCHEMA-CHECKED before it becomes anything. A container is
// a process the user's own agent runs shell commands inside, so its reports are
// input from a place the model reaches — not a trusted peer's RPC.
// ---------------------------------------------------------------------------

import { AgentReportSchema, type AgentReport } from "@repo/agent-container/protocol";
import { Value } from "@sinclair/typebox/value";

import type { AgentRunner } from "../agent/agent-runner";
import { oauthResultPage, providerRefusalMessage } from "../agent/provider-oauth";
import type { PendingAuthorization, ProviderCredentials } from "../agent/provider-credentials";
import { verifyScopedToken } from "../agent/agent-crypto";
import { readBearer } from "./session";

/**
 * Answer one container report.
 *
 * The bearer proves three things at once, and the third is the newest: this
 * object, the container generation it was minted for, and WHICH LANE that
 * container is — the conversation's or the unattended one. The lane decides
 * whether the report's writes land under the chat undo toast or a background
 * task's "Restore original", so it is read off the credential rather than
 * accepted from the body a container composes.
 */
export async function handleAgentReport(request: Request, runner: AgentRunner): Promise<Response> {
  const token = readBearer(request.headers);
  if (token === null) return new Response("unauthorized", { status: 401 });
  const lane = await runner.resolveReportLane(token);
  if (lane === null) return new Response("unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("malformed report", { status: 400 });
  }
  if (!Value.Check(AgentReportSchema, body)) {
    const first = Value.Errors(AgentReportSchema, body).First();
    return new Response(`malformed report — ${first?.message ?? "shape mismatch"}`, {
      status: 400,
    });
  }
  const report: AgentReport = body;
  return Response.json(await runner.report(report, lane));
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
