// Shared filesystem paths the desktop agent uses. The layout now lives in
// @repo/agent-host/paths (Electron-free, relocatable via INTELIGIR_HOME) so a
// headless runner can reuse the exact same structure. This module binds the
// host paths to the desktop's home (~/.inteligir) and keeps the existing
// constant names so other agent/* modules don't change. Provider/model
// selection is desktop config, owned here and injected into AgentHost.

import path from "node:path";

import {
  configurePaths as configureHostPaths,
  resolveAgentPaths,
} from "@repo/agent-host/paths";

const PATHS = resolveAgentPaths();

/** Provider in pi-ai's model registry. */
export const AUTH_PROVIDER = "openai-codex";

/** Default model id for new sessions. */
export const MODEL_ID = "gpt-5.5";

/** ~/.inteligir — used as pi's agentDir so all discovery looks here. */
export const AGENT_DIR = PATHS.agentDir;
export const AUTH_PATH = PATHS.authPath;
export const SESSION_DIR = PATHS.sessionDir;
/** Session dir for the background task agent. MUST be separate from
 * SESSION_DIR: the user agent resumes the most-recently-modified session in
 * SESSION_DIR via continueRecent(), so an overnight task run there would be
 * resumed as the user's thread on the next launch. */
export const BACKGROUND_SESSION_DIR = path.join(PATHS.sessionDir, "background");
export const WORKSPACE_DIR = PATHS.workspaceDir;
export const BIN_DIR = PATHS.binDir;
export const EXTENSIONS_DIR = PATHS.extensionsDir;

/**
 * Override pi-coding-agent's default getAgentDir() (~/.pi/agent). Must be
 * called once at process startup, before any pi-coding-agent module loads.
 *
 * Kept a function (not an import-time statement) so the only side effect that
 * matters — mutating process.env["PI_CODING_AGENT_DIR"] — happens on demand,
 * which keeps tests and reload flows easy to reason about. The path constants
 * above are plain module-load computations, same as the original module
 * (which read os.homedir() at import); they mutate nothing.
 */
export function configurePaths(): void {
  // Pin to the same home AGENT_DIR/SESSION_DIR/auth were derived from at import,
  // rather than letting the host re-resolve resolveAgentHome() independently.
  // Guarantees PI_CODING_AGENT_DIR can never desync from the path constants the
  // Agent uses, even if the environment changed after this module loaded.
  configureHostPaths(AGENT_DIR);
}
