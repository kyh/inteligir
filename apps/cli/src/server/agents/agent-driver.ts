// a runtime missing from this copy of the app refuses a send synchronously rather than wedging a
// thread on an async spawn failure. a signed-out vendor is not refused here: its adapter refuses the
// session, and that refusal is the one that names the vendor.

import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/domain/notifier";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import type { CreateTurnDriver } from "../threads/turn-driver";
import { createUnavailableTurnDriver } from "../threads/turn-driver";
import type { AcpAgentRuntimeOptions } from "@repo/agent-runtime/acp/acp-runtime";
import { HARNESSES, isHarnessId } from "@repo/agent-runtime/acp/harness-registry";
import type { HarnessId } from "@repo/agent-runtime/acp/harness-registry";
import type { AppConfig } from "../config";
import type { DebugLog } from "../debug-log";
import type { VaultRuntime } from "../vault/vault-runtime";
import { createBoundedAgentLog } from "./agent-log";
import type { AgentSessionFacts } from "./agent-shell-env";
import { createAcpRuntimeManager } from "./runtime-manager";
import type { AcpRuntimeManagerDeps } from "./runtime-manager";
import { createScriptedTurnDriverFactory } from "./scripted-driver";
import type { ScriptedDriverDeps } from "./scripted-driver";
import type { AgentAccounts } from "./agent-sign-in";

export interface ResolveAgentDriverArgs {
  config: Pick<AppConfig, "agent" | "agentModels" | "vaultDir">;
  db: DbConnection;
  notifier: DbNotifier;
  vault: VaultRuntime;
  // a getter, read per session open, so a Settings edit reaches the next session without a reboot.
  sessionFacts: () => AgentSessionFacts;
  // the stored choice, read per thread start for the same reason; null falls back to claude
  preferredProviderId?: () => HarnessId | null;
  // each vendor's own sign-in answer and the sign-in itself; carried here because only serve.ts may
  // build what spawns one.
  accounts: AgentAccounts;
  env?: NodeJS.ProcessEnv;
  // absent: the runtime forks each adapter with child_process
  spawnAdapter?: AcpAgentRuntimeOptions["spawnAdapter"];
  // the ACP frames each adapter trades; the scripted driver speaks none.
  debugLog?: DebugLog | undefined;
}

// a write the agent made through the server rather than its own tools, named by the thread whose
// shell sent it; a thread with no turn running records nothing.
export type RecordAgentWrites = (threadId: string, paths: readonly string[]) => void;

export interface ResolvedAgentDriver {
  // read per request: a runtime removed from under a running app is the next answer.
  status: () => AgentStatus;
  accounts: AgentAccounts;
  createTurnDriver: CreateTurnDriver;
  recordAgentWrites: RecordAgentWrites;
  dispose: () => Promise<void>;
}

const noDispose = async (): Promise<void> => {
  /* empty */
};

const recordNothing: RecordAgentWrites = () => {
  /* empty */
};

export const defaultHarnessId = (preferred: HarnessId | null): HarnessId => preferred ?? "claude";

// a provider this build does not know is left to the runtime, whose refusal names it.
const missingRuntime = (providerId: string, env: NodeJS.ProcessEnv): string | null => {
  if (!isHarnessId(providerId)) {
    return null;
  }
  const harness = HARNESSES[providerId];
  return harness.vendorExecutable(env) === null
    ? `This copy of inteligir is missing its ${harness.displayName} runtime — reinstall it`
    : null;
};

export const resolveAgentDriver = (args: ResolveAgentDriverArgs): ResolvedAgentDriver => {
  const mode = args.config.agent;
  const { accounts } = args;
  if (mode === "off") {
    const detail = "The agent is disabled (INTELIGIR_AGENT=off)";
    return {
      accounts,
      createTurnDriver: () => createUnavailableTurnDriver(detail),
      dispose: noDispose,
      recordAgentWrites: recordNothing,
      status: () => ({ detail, mode, runtime: "off" }),
    };
  }
  const onDebug = createBoundedAgentLog();
  if (mode === "scripted") {
    const scripted: ScriptedDriverDeps = {
      git: args.vault.git,
      notifier: args.notifier,
      onError: onDebug,
      vault: args.vault.service,
    };
    return {
      accounts,
      createTurnDriver: createScriptedTurnDriverFactory(scripted),
      dispose: noDispose,
      recordAgentWrites: recordNothing,
      status: () => ({ detail: null, mode, runtime: "scripted" }),
    };
  }

  const env = args.env ?? process.env;
  const defaultProviderId = (): HarnessId => defaultHarnessId(args.preferredProviderId?.() ?? null);
  const acp: AcpRuntimeManagerDeps = {
    db: args.db,
    debugLog: args.debugLog,
    defaultProviderId,
    git: args.vault.git,
    hostEnv: env,
    models: args.config.agentModels,
    notifier: args.notifier,
    onDebug,
    sessionFacts: args.sessionFacts,
    unavailableReason: (providerId) => missingRuntime(providerId, env),
    vaultDir: args.config.vaultDir,
  };
  if (args.spawnAdapter !== undefined) {
    acp.spawnAdapter = args.spawnAdapter;
  }
  const manager = createAcpRuntimeManager(acp);
  return {
    accounts,
    createTurnDriver: manager.createTurnDriver,
    dispose: async () => {
      await manager.dispose();
    },
    recordAgentWrites: manager.recordAgentWrites,
    // the harness a new thread would start on.
    status: () => {
      const detail = missingRuntime(defaultProviderId(), env);
      return detail === null
        ? { detail: null, mode, runtime: "acp" }
        : { detail, mode, runtime: "unavailable" };
    },
  };
};
