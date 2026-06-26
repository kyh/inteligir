// Shared filesystem paths the desktop agent uses. Imported by setup.ts,
// auth.ts, agent.ts; isolating keeps every other agent/* module from
// reaching across each other for path constants.

import os from "node:os";
import path from "node:path";

// Mirrors inteligirPath in main/lib/json-store.ts. Deliberately duplicated
// (it's three lines) so agent/ keeps zero @/main imports — the dependency
// direction is one-way: main composes, agent receives.
const INTELIGIR_DIR = path.join(os.homedir(), ".inteligir");

export function inteligirPath(...segments: string[]): string {
  return path.join(INTELIGIR_DIR, ...segments);
}

/** Provider in pi-ai's model registry. */
export const AUTH_PROVIDER = "openai-codex";

/** Default model id for new sessions. */
export const MODEL_ID = "gpt-5.5";

/** ~/.inteligir — used as pi's agentDir so all discovery looks here. */
export const AGENT_DIR = inteligirPath();
export const AUTH_PATH = inteligirPath("auth.json");
export const SESSION_DIR = inteligirPath("sessions");
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
