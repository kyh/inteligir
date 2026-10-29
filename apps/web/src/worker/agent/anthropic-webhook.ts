// `/hooks/anthropic`, the one door Anthropic's servers knock on: outside `/v1`, since its POST
// carries no device credential, no cookie and no build. The body is read raw and verified with
// the SDK's `webhooks.unwrap`, the Standard Webhooks signature over it under this deployment's
// signing key, and a body that does not verify is refused; one that does is answered 200 at once
// and routed after, since an endpoint that keeps failing or answers slowly is disabled
// (platform.claude.com/docs/en/managed-agents/webhooks). A session's idle or end goes to the cell
// of the account its metadata names, which reconciles its open turn; a credential Anthropic could
// not refresh goes to the cell its vault's metadata names, which repairs it. Each event is routed
// once by its id, which the cell keeps beside its own writes' ids. Only production registers this
// endpoint, and a deployment with no signing key answers that none is here.

import { z } from "zod";

import { libraryCell } from "../library/library-cell";
import { callFailureFields, managedAgents } from "./managed-agents";
import type { ManagedAgents } from "./managed-agents";

export const ANTHROPIC_WEBHOOK_PATH = "/hooks/anthropic";

// a webhook's body is a few hundred bytes; past this it is no webhook of Anthropic's
const WEBHOOK_MAX_BYTES = 64 * 1024;

const accountIdSchema = z.string().min(1).max(128);

// what a verified event asks of a cell, by the account it belongs to
export type WebhookAsk = "reconcile" | "repair";

const routeEvent = async (
  agents: ManagedAgents,
  exports: Cloudflare.Exports,
  event: ReturnType<ManagedAgents["client"]["beta"]["webhooks"]["unwrap"]>,
): Promise<void> => {
  const { data } = event;
  try {
    if (data.type === "session.status_idled" || data.type === "session.status_terminated") {
      const session = await agents.client.beta.sessions.retrieve(data.id);
      const accountId = accountIdSchema.safeParse(session.metadata["accountId"]);
      if (accountId.success) {
        await libraryCell(exports, accountId.data).agentWebhook(event.id, "reconcile");
      }
    } else if (data.type === "vault_credential.refresh_failed") {
      const vault = await agents.client.beta.vaults.retrieve(data.vault_id);
      const accountId = accountIdSchema.safeParse(vault.metadata["account_id"]);
      if (accountId.success) {
        await libraryCell(exports, accountId.data).agentWebhook(event.id, "repair");
      }
    }
  } catch (error) {
    // the cell's alarm reconciles every open turn anyway, and a repair asks again
    console.warn({
      event: "anthropic-webhook-route-failed",
      type: data.type,
      ...callFailureFields(error),
    });
  }
};

export const handleAnthropicWebhook = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  if (request.method !== "POST") {
    return new Response("Anthropic's webhooks are POSTed.", {
      headers: { allow: "POST" },
      status: 405,
    });
  }
  const agents = managedAgents(env);
  const key = env.ANTHROPIC_WEBHOOK_SIGNING_KEY;
  if (agents === null || key === undefined || key === "") {
    return new Response("No webhook is registered here.", { status: 404 });
  }
  if (Number(request.headers.get("content-length") ?? "0") > WEBHOOK_MAX_BYTES) {
    return new Response("That is no webhook of Anthropic's.", { status: 413 });
  }
  const body = await request.text();
  if (body.length > WEBHOOK_MAX_BYTES) {
    return new Response("That is no webhook of Anthropic's.", { status: 413 });
  }
  let event: ReturnType<typeof agents.client.beta.webhooks.unwrap>;
  try {
    event = agents.client.beta.webhooks.unwrap(body, {
      headers: Object.fromEntries(request.headers),
      key,
    });
  } catch {
    console.warn({ event: "anthropic-webhook-refused" });
    return new Response("That webhook's signature does not verify.", { status: 400 });
  }
  ctx.waitUntil(routeEvent(agents, ctx.exports, event));
  return new Response(null, { status: 200 });
};
