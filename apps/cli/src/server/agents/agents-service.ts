import type { AgentsStatusResponse } from "@repo/api/local/agents/agents-schema";
import { isHarnessId } from "@repo/agent-runtime/acp/harness-registry";

import { defaultHarnessId } from "./agent-driver";
import type { AgentPrefsStore } from "./agent-prefs-store";
import { probeHarnesses } from "./agent-status-probe";

export class UnknownHarnessError extends Error {}

export interface AgentsService {
  status(): Promise<AgentsStatusResponse>;
  setDefault(id: string): Promise<AgentsStatusResponse>;
}

export interface CreateAgentsServiceArgs {
  store: AgentPrefsStore;
  env: NodeJS.ProcessEnv;
}

// facts, not verdicts: the probe reports what is on PATH and signed in, and the default is
// stored whether or not that harness is ready, so Settings can show the gap rather than hide it.
export function createAgentsService(args: CreateAgentsServiceArgs): AgentsService {
  const status = async (): Promise<AgentsStatusResponse> => ({
    harnesses: await probeHarnesses(args.env),
    defaultId: defaultHarnessId(args.store.read().defaultHarness ?? null, args.env),
  });
  return {
    status,
    async setDefault(id) {
      if (!isHarnessId(id)) {
        throw new UnknownHarnessError(`no harness is called "${id}"`);
      }
      args.store.write({ ...args.store.read(), defaultHarness: id });
      return status();
    },
  };
}
