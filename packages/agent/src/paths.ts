// Shared filesystem paths the desktop agent uses. Imported by setup.ts,
// auth.ts, agent.ts; isolating keeps every other agent/* module from
// reaching across each other for path constants.

import os from "node:os";
import path from "node:path";

// Mirrors inteligirPath in server/storage/json-store.ts. Deliberately duplicated
// (it's three lines) so agent/ keeps zero imports from the rest of
// @repo/features/server (lint-enforced) — the dependency direction is
// one-way: the host composes, agent receives.
const INTELIGIR_DIR = path.join(os.homedir(), ".inteligir");

export function inteligirPath(...segments: string[]): string {
  return path.join(INTELIGIR_DIR, ...segments);
}

/** ~/.inteligir — used as pi's agentDir so all discovery looks here. */
export const AGENT_DIR = inteligirPath();
export const AUTH_PATH = inteligirPath("auth.json");
export const SESSION_DIR = inteligirPath("sessions");
/** Session dir for the background delegation agent. MUST be separate from
 * SESSION_DIR: the user agent resumes the most-recently-modified session in
 * SESSION_DIR via continueRecent(), so a delegation run there would be resumed
 * as the user's thread on the next launch. */
export const BACKGROUND_SESSION_DIR = inteligirPath("sessions", "background");
/** Isolated session for inline-AI text generation — kept out of the user's
 * continueRecent pool like the delegation session. */
export const INLINE_AI_SESSION_DIR = inteligirPath("sessions", "inline-ai");
/** ~/.inteligir-relative segments of every pi session dir above — the single
 * source hardenAppDir sweeps for 0600 transcript modes. A new session dir MUST
 * be added here or its *.jsonl transcripts (note content) stay world-readable. */
export const SESSION_DIR_SEGMENTS = ["sessions", "sessions/background", "sessions/inline-ai"];
export const WORKSPACE_DIR = inteligirPath("workspace");
export const BIN_DIR = inteligirPath("bin");
export const EXTENSIONS_DIR = inteligirPath("extensions");

/**
 * Override pi-coding-agent's default getAgentDir() (~/.pi/agent). Must be
 * called once at process startup, before any pi-coding-agent module loads.
 * Lives behind a function so paths.ts has no import-time side effects (which
 * makes tests + reload flows easier to reason about).
 */
export function configurePaths(): void {
  process.env["PI_CODING_AGENT_DIR"] = AGENT_DIR;
}
