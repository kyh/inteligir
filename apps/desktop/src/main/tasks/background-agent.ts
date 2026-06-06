// ---------------------------------------------------------------------------
// Background task agent — a second, dedicated Agent that runs scheduled tasks
// off the user-facing session.
//
// Scheduled tasks must never block the user's thread, inject into it, or
// interleave with external chat relay turns. So they run on their own
// PiAgent with its own session directory (BACKGROUND_SESSION_DIR) — fully
// independent of the user agent in app-machine.ts. A second concurrent PiAgent
// is safe: PiAgent/SessionManager state is instance-scoped, auth storage is
// read-only-shared, and the executor daemon is a process singleton whose
// start() is idempotent (both agents share the one daemon).
//
// Crucially this holder does NOT subscribe the agent to broadcast/notifications
// the way the user agent does — background turns stay out of the renderer's
// chat thread and the dock idle pings by construction. Their results are
// captured by TaskManager via getLastAssistantText() and persisted to the
// TaskRunLog, which the daily refresh later summarizes.
// ---------------------------------------------------------------------------

import { Agent } from "@/agent/agent";
import { BACKGROUND_SESSION_DIR } from "@/agent/paths";

let bgAgent: Agent | null = null;

/** Start the background task agent. Always a fresh session: overnight results
 * live in the TaskRunLog (the summary's source of truth), so the background
 * thread needs no continuity and a clean thread avoids unbounded growth. */
export async function startBackgroundAgent(): Promise<void> {
  if (bgAgent) return;
  const next = new Agent({ newSession: true, sessionDir: BACKGROUND_SESSION_DIR });
  await next.start();
  bgAgent = next;
}

/** Stop the background agent. Does NOT touch the executor daemon — that is a
 * shared singleton owned by the user-agent/shell lifecycle (stopAgent). */
export async function stopBackgroundAgent(): Promise<void> {
  if (bgAgent) {
    await bgAgent.stop();
    bgAgent = null;
  }
}

export function getBackgroundAgent(): Agent | null {
  return bgAgent;
}
