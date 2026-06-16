// Desktop binding of the Electron-free AgentHost (@repo/agent-host). It wires
// the host's parameterized lifecycle to the desktop's ~/.inteligir paths,
// on-device OpenAI auth, resolved model, and the auto-discovered extension
// bundles (which act through the main-owned ports passed at construction). The
// lifecycle (session resolution, the agent surface) lives in the host so a
// future cloud runner reuses it with its own factories.
//
// Auth and model are passed as thunks so a synchronous resolveModel failure
// surfaces through the async start() path rather than out of `new Agent()`.

import { AgentHost } from "@repo/agent-host/agent";
import { resolveModel } from "@repo/pi-driver/model";

import { getAuthStorage } from "@/agent/auth";
import { buildValidatedFactories, type AgentPorts } from "@/agent/extension";
import { AGENT_DIR, AUTH_PROVIDER, MODEL_ID, SESSION_DIR, WORKSPACE_DIR } from "@/agent/paths";
import { EXTENSION_BUNDLES, buildRegisterContext } from "@/agent/setup";

/** Pi built-in coding tools the session starts with. Mirrors pi's own default
 * — declared explicitly so the raw system-access surface is a deliberate,
 * auditable choice (see resources/agent/AGENTS.md "System access"). Extension
 * tools (manage_ui, execute, browser, …) activate as they register. */
const INITIAL_ACTIVE_TOOLS = ["read", "bash", "edit", "write"];

export type AgentOptions = {
  /** Main-owned capabilities (shell, tasks, executor) handed to extension
   * bundles at register time. Built main-side by agent-lifecycle.ts. */
  ports: AgentPorts;
  /** If true, start a fresh session instead of resuming the most recent one. */
  newSession?: boolean;
  /** Session directory to read/write. Defaults to SESSION_DIR (the user-facing
   * thread). The background task agent passes BACKGROUND_SESSION_DIR so its runs
   * never land in the user's continueRecent pool. */
  sessionDir?: string;
};

export class Agent extends AgentHost {
  constructor(opts: AgentOptions) {
    super({
      cwd: WORKSPACE_DIR,
      agentDir: AGENT_DIR,
      sessionDir: opts.sessionDir ?? SESSION_DIR,
      authStorage: () => getAuthStorage(),
      model: () => resolveModel(AUTH_PROVIDER, MODEL_ID),
      extensionFactories: () =>
        buildValidatedFactories(EXTENSION_BUNDLES, buildRegisterContext(opts.ports)),
      initialActiveToolNames: INITIAL_ACTIVE_TOOLS,
      // exactOptionalPropertyTypes: omit rather than pass an explicit undefined.
      ...(opts.newSession !== undefined ? { newSession: opts.newSession } : {}),
    });
  }
}
