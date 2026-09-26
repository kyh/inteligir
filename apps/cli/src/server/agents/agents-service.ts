import type { AgentsStatusResponse, HarnessStatus } from "@repo/api/local/agents/agents-schema";
import { HARNESS_IDS, HARNESSES, harnessIdSchema } from "@repo/agent-runtime/acp/harness-registry";
import type { HarnessId } from "@repo/agent-runtime/acp/harness-registry";

import { defaultHarnessId } from "./agent-driver";
import type { AgentPrefsStore } from "./agent-prefs-store";
import type { VendorAccounts } from "./vendor-accounts";

export class UnknownHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownHarnessError";
  }
}

export interface AgentsService {
  status: () => Promise<AgentsStatusResponse>;
  setDefault: (id: string) => Promise<AgentsStatusResponse>;
}

export interface CreateAgentsServiceArgs {
  store: AgentPrefsStore;
  accounts: VendorAccounts;
  env: NodeJS.ProcessEnv;
}

// facts, not verdicts: each vendor's own answer about its sign-in, and the default is stored
// whether or not that harness is ready, so Settings can show the gap rather than hide it.
export const createAgentsService = (args: CreateAgentsServiceArgs): AgentsService => {
  const harnessStatus = async (id: HarnessId): Promise<HarnessStatus> => {
    const { displayName } = HARNESSES[id];
    if (HARNESSES[id].vendorExecutable(args.env) === null) {
      return { displayName, id, runtime: "missing" };
    }
    return { account: await args.accounts.status(id), displayName, id, runtime: "bundled" };
  };
  const status = async (): Promise<AgentsStatusResponse> => ({
    defaultId: defaultHarnessId(args.store.read().defaultHarness ?? null),
    harnesses: await Promise.all(HARNESS_IDS.map(harnessStatus)),
  });
  return {
    async setDefault(id) {
      const parsed = harnessIdSchema.safeParse(id);
      if (!parsed.success) {
        throw new UnknownHarnessError(`no harness is called "${id}"`);
      }
      args.store.write({ ...args.store.read(), defaultHarness: parsed.data });
      return await status();
    },
    status,
  };
};
