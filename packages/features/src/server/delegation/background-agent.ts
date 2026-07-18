// ---------------------------------------------------------------------------
// Background delegation agent — a second, dedicated Agent that runs delegated
// checkboxes off the user-facing session.
//
// Delegations must never block the user's thread or interleave with it, so they
// run on their own PiAgent with its own session directory
// (BACKGROUND_SESSION_DIR), fully independent of the user agent in
// app-machine.ts. A second concurrent PiAgent is safe: session state is
// instance-scoped, auth storage is read-only-shared, and the executor daemon is
// a process singleton whose start() is idempotent (both agents share one daemon).
//
// This holder does NOT subscribe the agent to the renderer chat broadcast — its
// turns stay out of the user's thread by construction. The delegation-manager
// captures results from the event stream instead.
// ---------------------------------------------------------------------------

import { Agent } from "../agent/agent";
import { BACKGROUND_SESSION_DIR } from "../agent/paths";
import { resolveSelectedModel } from "../provider/provider-service";
import { getAgentPorts } from "../lib/agent-lifecycle";

let bgAgent: Agent | null = null;

/** Start the background delegation agent. Always a fresh session — delegation
 * runs are independent and their results live in the delegations store, so the
 * thread needs no continuity and a clean thread avoids unbounded growth. */
export async function startBackgroundAgent(): Promise<void> {
  if (bgAgent) return;
  const next = new Agent({
    newSession: true,
    sessionDir: BACKGROUND_SESSION_DIR,
    resolveModel: resolveSelectedModel,
    // Tool-gate checkpoints are the CHAT undo surface — disabled here. This
    // agent's undo is the pre-run delegation snapshot (delegation-manager)
    // behind the dock's "Restore original"; hook captures from this session
    // would surface nowhere and could only mislabel the chat undo toast. Its
    // off-target edits (files other than the delegated note) remain
    // uncovered, exactly as before the checkpoint seam existed.
    ports: { ...getAgentPorts(), checkpoints: null },
  });
  await next.start();
  bgAgent = next;
}

/** Stop the background agent. Does NOT touch the executor daemon — that is a
 * shared singleton owned by the user-agent lifecycle (stopAgent). */
export async function stopBackgroundAgent(): Promise<void> {
  const agent = bgAgent;
  if (!agent) return;
  // Clear the singleton up front so a stop() that throws can't wedge it — a
  // later startBackgroundAgent() would otherwise short-circuit on the stale ref.
  bgAgent = null;
  await agent.stop().catch(() => {});
}

export function getBackgroundAgent(): Agent | null {
  return bgAgent;
}
