// Shared filesystem paths the desktop agent uses. The layout + provider/model
// defaults now live in @repo/agent-host/paths (Electron-free, relocatable via
// INTELIGIR_HOME) so a headless runner can reuse the exact same structure.
// This module binds the host paths to the desktop's home (~/.inteligir) and
// keeps the existing constant names so other agent/* modules don't change.

import {
  AUTH_PROVIDER as HOST_AUTH_PROVIDER,
  MODEL_ID as HOST_MODEL_ID,
  configurePaths as configureHostPaths,
  resolveAgentPaths,
} from "@repo/agent-host/paths";

const PATHS = resolveAgentPaths();

/** Provider in pi-ai's model registry. */
export const AUTH_PROVIDER = HOST_AUTH_PROVIDER;

/** Default model id for new sessions. */
export const MODEL_ID = HOST_MODEL_ID;

/** ~/.inteligir — used as pi's agentDir so all discovery looks here. */
export const AGENT_DIR = PATHS.agentDir;
export const AUTH_PATH = PATHS.authPath;
export const SESSION_DIR = PATHS.sessionDir;
/** Session dir for the background task agent. MUST be separate from
 * SESSION_DIR: the user agent resumes the most-recently-modified session in
 * SESSION_DIR via continueRecent(), so an overnight task run there would be
 * resumed as the user's thread on the next launch. */
export const BACKGROUND_SESSION_DIR = PATHS.backgroundSessionDir;
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
