// Filesystem layout + provider/model defaults for the agent host. Electron-
// free: the base dir resolves from os.homedir() by default, but INTELIGIR_HOME
// lets a headless/cloud runner relocate all agent state without code changes.
//
// The desktop app binds these to ~/.inteligir (its existing layout); a cloud
// container can point INTELIGIR_HOME at a per-session scratch dir and get the
// exact same structure.

import os from "node:os";
import path from "node:path";

/** Provider in pi-ai's model registry. */
export const AUTH_PROVIDER = "openai-codex";

/** Default model id for new sessions. */
export const MODEL_ID = "gpt-5.5";

/**
 * Root directory for all agent state. Defaults to `~/.inteligir`; override
 * with INTELIGIR_HOME so the same host can run against a container-local path.
 */
export function resolveAgentHome(): string {
  const override = process.env["INTELIGIR_HOME"];
  if (override && override.trim() !== "") return override;
  return path.join(os.homedir(), ".inteligir");
}

export type AgentPaths = {
  /** pi's agentDir — skills, AGENTS.md, sessions all hang off here. */
  agentDir: string;
  /** OAuth credential file (pi AuthStorage). */
  authPath: string;
  /** Persisted session transcripts. */
  sessionDir: string;
  /**
   * Session dir for the background task agent. Kept separate from sessionDir:
   * the user agent resumes the most-recently-modified session in sessionDir via
   * continueRecent(), so an overnight background run there would be resumed as
   * the user's thread on the next launch.
   */
  backgroundSessionDir: string;
  /** Agent working directory (cwd for shell/file tools). */
  workspaceDir: string;
  /** Installed-CLI bin dir, prepended to PATH so agent tools resolve. */
  binDir: string;
  /** Extension scratch/config dir. */
  extensionsDir: string;
};

/** Derive the full path layout from an agent home (defaults to resolveAgentHome). */
export function resolveAgentPaths(home: string = resolveAgentHome()): AgentPaths {
  return {
    agentDir: home,
    authPath: path.join(home, "auth.json"),
    sessionDir: path.join(home, "sessions"),
    backgroundSessionDir: path.join(home, "sessions", "background"),
    workspaceDir: path.join(home, "workspace"),
    binDir: path.join(home, "bin"),
    extensionsDir: path.join(home, "extensions"),
  };
}

/**
 * Point pi-coding-agent's getAgentDir() at our home instead of its default
 * (~/.pi/agent). Must run once at process startup, before any pi-coding-agent
 * module loads. Kept as a function so this module has no import-time side
 * effects.
 */
export function configurePaths(home: string = resolveAgentHome()): void {
  process.env["PI_CODING_AGENT_DIR"] = home;
}
