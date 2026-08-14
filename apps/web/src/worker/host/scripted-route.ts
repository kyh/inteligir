// ---------------------------------------------------------------------------
// `POST /v1/host/scripted` — the drive seam, off the production contract.
//
// Two capabilities exist only under `AGENT_RUNTIME=scripted`: seeding the fake
// container's response queue, and reading back the chat agent's composed system
// prompt. They used to be Bridge channels, which put them in the contract every
// client bundles, in the host's required-handler set, in the agent grant table
// and in the fixture Bridge — and one of them threw on the real runtime, against
// the registry's own rule that a capability this host does not have has no
// channel at all.
//
// A leaf instead. It costs nothing the socket was paying: `routeHost` already
// proves a session and addresses the caller's own object before this runs, so
// there is no userId on the path and no second derivation to keep honest — the
// same admission every other leaf gets.
//
// Fail-closed on the runtime, not on the caller: a deployment running a real
// container has no queue to seed, and answers 404 as if the leaf were not
// there — which, for that deployment, it is.
// ---------------------------------------------------------------------------

import { FauxAgentScriptSchema } from "@repo/bridge/agent-script";
import { Value } from "@sinclair/typebox/value";

import type { AgentLane } from "../agent/agent-runner";
import type { FakeSandbox } from "../agent/fake-sandbox";

export type ScriptedRouteDeps = {
  /** A lane's scripted container, or `null` on the real runtime — the same
   * accessor the agent handlers take, so "is this deployment scripted" has one
   * answer. */
  readonly scripted: (lane: AgentLane) => FakeSandbox | null;
  /** The chat agent's composed system prompt, for byte-exact assertions. */
  readonly systemPrompt: () => Promise<string>;
};

const NOT_SCRIPTED = new Response("not found", { status: 404 });

export async function handleScriptedRoute(
  request: Request,
  deps: ScriptedRouteDeps,
): Promise<Response> {
  const chat = deps.scripted("chat");
  if (chat === null) return NOT_SCRIPTED;

  const verb = new URL(request.url).searchParams.get("verb");
  if (verb === "system-prompt") {
    return Response.json({ prompt: await deps.systemPrompt() });
  }
  if (verb !== "script") {
    return new Response("unknown verb", { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("expected a json body", { status: 400 });
  }
  if (!Value.Check(FauxAgentScriptSchema, body)) {
    return new Response("payload validation failed", { status: 400 });
  }
  // BOTH lanes take the script. A drive that delegates a checkbox needs the
  // unattended container to answer too, and the caller has no way to name a
  // lane — nor should it, since the lane is a fact of how a turn was started.
  chat.setScript(body);
  deps.scripted("background")?.setScript(body);
  return new Response(null, { status: 204 });
}
