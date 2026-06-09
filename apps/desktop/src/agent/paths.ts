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
 */
export function configurePaths(): void {
  configureHostPaths();
}
