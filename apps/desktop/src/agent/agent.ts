// Desktop binding of the Electron-free AgentHost (@repo/agent-host). It wires
// the host's parameterized lifecycle to the desktop's ~/.inteligir paths,
// on-device OpenAI auth, resolved model, and the auto-discovered Electron-
// coupled extension bundles. All the actual lifecycle (session resolution,
// extension validation, the agent surface) lives in the host so a future cloud
// runner reuses it with its own bundles/auth.
//
// Auth and model are passed as thunks so a synchronous resolveModel failure
// surfaces through the async start() path rather than out of `new Agent()`.

import { AgentHost } from "@repo/agent-host/agent";
import { resolveModel } from "@repo/pi-driver/model";

import { getAuthStorage } from "@/agent/auth";
import { AGENT_DIR, AUTH_PROVIDER, MODEL_ID, SESSION_DIR, WORKSPACE_DIR } from "@/agent/paths";
import { EXTENSION_BUNDLES, buildRegisterContext } from "@/agent/setup";

export type AgentOptions = {
  /** If true, start a fresh session instead of resuming the most recent one. */
  newSession?: boolean;
  /** Session directory to read/write. Defaults to SESSION_DIR (the user-facing
   * thread). The background task agent passes BACKGROUND_SESSION_DIR so its runs
   * never land in the user's continueRecent pool. */
  sessionDir?: string;
};

export class Agent extends AgentHost {
  constructor(opts: AgentOptions = {}) {
    super({
      cwd: WORKSPACE_DIR,
      agentDir: AGENT_DIR,
      sessionDir: opts.sessionDir ?? SESSION_DIR,
      authStorage: () => getAuthStorage(),
      model: () => resolveModel(AUTH_PROVIDER, MODEL_ID),
      bundles: EXTENSION_BUNDLES,
      registerContext: () => buildRegisterContext(),
      newSession: opts.newSession,
    });
  }
}
