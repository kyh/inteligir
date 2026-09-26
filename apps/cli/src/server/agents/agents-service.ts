import type {
  AgentsSignInResponse,
  AgentsSignOutResponse,
  AgentsStatusResponse,
  HarnessStatus,
} from "@repo/api/local/agents/agents-schema";
import { HARNESS_IDS, HARNESSES, harnessIdSchema } from "@repo/agent-runtime/acp/harness-registry";
import type { HarnessId } from "@repo/agent-runtime/acp/harness-registry";

import { defaultHarnessId } from "./agent-driver";
import type { AgentPrefsStore } from "./agent-prefs-store";
import type { AgentAccounts } from "./agent-sign-in";

// what is refused before any vendor runs: a harness no row names, or one this copy of the app did
// not ship.
export class HarnessRefusedError extends Error {
  readonly kind: "not-found" | "unavailable";

  constructor(kind: "not-found" | "unavailable", message: string) {
    super(message);
    this.name = "HarnessRefusedError";
    this.kind = kind;
  }
}

const knownHarness = (id: string): HarnessId => {
  const parsed = harnessIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new HarnessRefusedError("not-found", `no harness is called "${id}"`);
  }
  return parsed.data;
};

export interface AgentsService {
  status: () => Promise<AgentsStatusResponse>;
  setDefault: (id: string) => Promise<AgentsStatusResponse>;
  signIn: (id: string) => Promise<AgentsSignInResponse>;
  cancelSignIn: (id: string) => Promise<AgentsStatusResponse>;
  signOut: (id: string) => Promise<AgentsSignOutResponse>;
}

export interface CreateAgentsServiceArgs {
  store: AgentPrefsStore;
  accounts: AgentAccounts;
  env: NodeJS.ProcessEnv;
}

interface RunningSignIn {
  id: HarnessId;
  cancel: AbortController;
  ended: Promise<unknown>;
}

// facts, not verdicts: each vendor's own answer about its sign-in, and the default is stored
// whether or not that harness is ready, so Settings can show the gap rather than hide it.
export const createAgentsService = (args: CreateAgentsServiceArgs): AgentsService => {
  const running = new Set<RunningSignIn>();

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
    signingIn: args.accounts.signingIn(),
  });

  const bundledHarness = (id: string): HarnessId => {
    const known = knownHarness(id);
    const harness = HARNESSES[known];
    if (harness.vendorExecutable(args.env) === null) {
      throw new HarnessRefusedError(
        "unavailable",
        `This copy of inteligir is missing its ${harness.displayName} runtime — reinstall it`,
      );
    }
    return known;
  };

  // a harness just signed in takes the default only from one a new thread could not run on, so a
  // second sign-in never moves a user off the agent they already use.
  const adoptDefault = async (id: HarnessId): Promise<void> => {
    const stored = args.store.read();
    if (stored.defaultHarness === id) {
      return;
    }
    const current = defaultHarnessId(stored.defaultHarness ?? null);
    const account = current === id ? null : await args.accounts.status(current);
    if (account === null || account.state !== "signed-in") {
      args.store.write({ ...stored, defaultHarness: id });
    }
  };

  return {
    async cancelSignIn(id) {
      const known = knownHarness(id);
      const cancelled = [...running].filter((entry) => entry.id === known);
      for (const entry of cancelled) {
        entry.cancel.abort();
      }
      await Promise.allSettled(cancelled.map(async (entry) => await entry.ended));
      return await status();
    },
    async setDefault(id) {
      const known = knownHarness(id);
      args.store.write({ ...args.store.read(), defaultHarness: known });
      return await status();
    },
    async signIn(id) {
      const known = bundledHarness(id);
      const cancel = new AbortController();
      const ended = args.accounts.signIn(known, cancel.signal);
      const entry: RunningSignIn = { cancel, ended, id: known };
      running.add(entry);
      try {
        const outcome = await ended;
        if (outcome.outcome === "signed-in") {
          await adoptDefault(known);
        }
        return { ...outcome, status: await status() };
      } finally {
        running.delete(entry);
      }
    },
    async signOut(id) {
      const outcome = await args.accounts.signOut(bundledHarness(id));
      return { ...outcome, status: await status() };
    },
    status,
  };
};
