import type {
  AgentsSignInCodeResponse,
  AgentsSignInResponse,
  AgentsSignOutResponse,
  AgentsStatusResponse,
  HarnessStatus,
} from "@repo/contract/local/agents/agents-schema";
import { HARNESS_IDS } from "@repo/domain/harness";
import type { HarnessId } from "@repo/domain/harness";
import { HARNESSES } from "@repo/agent-runtime/acp/harness-registry";

import type { AgentPrefsStore } from "./agent-prefs-store";
import type { AgentAccounts } from "./agent-sign-in";
import { missingRuntimeDetail } from "./vendor-process";

// what is refused before any vendor runs: a harness this copy of the app did not ship, or a sign-in
// code no running sign-in of that harness is waiting for.
type HarnessRefusal = "unavailable" | "no-code-wanted";

export class HarnessRefusedError extends Error {
  readonly kind: HarnessRefusal;

  constructor(kind: HarnessRefusal, message: string) {
    super(message);
    this.name = "HarnessRefusedError";
    this.kind = kind;
  }
}

export interface AgentsService {
  status: () => Promise<AgentsStatusResponse>;
  setDefault: (id: HarnessId) => Promise<AgentsStatusResponse>;
  signIn: (id: HarnessId) => Promise<AgentsSignInResponse>;
  cancelSignIn: (id: HarnessId) => Promise<AgentsStatusResponse>;
  signOut: (id: HarnessId) => Promise<AgentsSignOutResponse>;
  submitSignInCode: (id: HarnessId, code: string) => AgentsSignInCodeResponse;
}

export interface CreateAgentsServiceArgs {
  store: AgentPrefsStore;
  accounts: AgentAccounts;
  env: NodeJS.ProcessEnv;
}

// facts, not verdicts: each vendor's own answer about its sign-in, and the default is stored
// whether or not that harness is ready, so Settings can show the gap rather than hide it.
export const createAgentsService = (args: CreateAgentsServiceArgs): AgentsService => {
  const harnessStatus = async (id: HarnessId): Promise<HarnessStatus> => {
    const { displayName, vendorApp } = HARNESSES[id];
    if (HARNESSES[id].vendorExecutable(args.env) === null) {
      return { displayName, id, runtime: "missing", vendorApp };
    }
    return {
      account: await args.accounts.status(id),
      displayName,
      id,
      runtime: "bundled",
      vendorApp,
    };
  };
  const status = async (): Promise<AgentsStatusResponse> => ({
    defaultId: args.store.defaultHarness(),
    harnesses: await Promise.all(HARNESS_IDS.map(harnessStatus)),
    signingIn: args.accounts.signingIn(),
  });

  const bundledHarness = (id: HarnessId): HarnessId => {
    const harness = HARNESSES[id];
    if (harness.vendorExecutable(args.env) === null) {
      throw new HarnessRefusedError("unavailable", missingRuntimeDetail(harness));
    }
    return id;
  };

  // a harness just signed in takes the default only from one a new thread could not run on, so a
  // second sign-in never moves a user off the agent they already use.
  const adoptDefault = async (id: HarnessId): Promise<void> => {
    const stored = args.store.read();
    if (stored.defaultHarness === id) {
      return;
    }
    const current = args.store.defaultHarness();
    const account = current === id ? null : await args.accounts.status(current);
    if (account === null || account.state !== "signed-in") {
      args.store.write({ ...stored, defaultHarness: id });
    }
  };

  return {
    async cancelSignIn(id) {
      await args.accounts.cancel(id);
      return await status();
    },
    async setDefault(id) {
      args.store.write({ ...args.store.read(), defaultHarness: id });
      return await status();
    },
    async signIn(id) {
      const outcome = await args.accounts.signIn(bundledHarness(id));
      if (outcome.outcome === "signed-in") {
        await adoptDefault(id);
      }
      return { ...outcome, status: await status() };
    },
    async signOut(id) {
      const outcome = await args.accounts.signOut(bundledHarness(id));
      return { ...outcome, status: await status() };
    },
    status,
    submitSignInCode(id, code) {
      const outcome = args.accounts.submitCode(id, code);
      if (outcome === "not-waiting") {
        throw new HarnessRefusedError(
          "no-code-wanted",
          `${HARNESSES[id].displayName} is not waiting for a sign-in code; start signing in first.`,
        );
      }
      return { outcome };
    },
  };
};
