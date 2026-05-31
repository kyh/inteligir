// Shared filesystem paths the desktop agent uses. Imported by setup.ts,
// auth.ts, agent.ts; isolating keeps every other agent/* module from
// reaching across each other for path constants.

import { inteligirPath } from "@/main/lib/json-store";

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

// Override pi-coding-agent's default getAgentDir() (~/.pi/agent). Imported
// for side-effect by setup.ts at module load.
process.env["PI_CODING_AGENT_DIR"] = AGENT_DIR;
