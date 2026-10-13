// a runtime missing from this copy of the app refuses a send synchronously rather than wedging a
// thread on an async spawn failure. a signed-out vendor is not refused here: its adapter refuses the
// session, and that refusal is the one that names the vendor.

import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/domain/notifier";
import type { AgentStatus } from "@repo/contract/local/system/system-schema";
import { createUnavailableTurnDriver } from "../threads/turn-driver";
import type { ProviderEventSink, TurnDriver } from "../threads/turn-driver";
import type { AcpAgentRuntimeOptions } from "@repo/agent-runtime/acp/acp-runtime";
import type { HarnessId } from "@repo/domain/harness";
import { HARNESSES } from "@repo/agent-runtime/acp/harness-registry";
import type { AppConfig } from "../config";
import type { DebugLog } from "../debug-log";
import type { VaultRuntime } from "../vault/vault-runtime";
import { createBoundedAgentLog } from "./agent-log";
import type { AgentSessionFacts } from "./agent-shell-env";
import { AcpTurnDriver } from "./runtime-manager";
import type { AcpTurnDriverDeps } from "./runtime-manager";
import { ScriptedTurnDriver } from "./scripted-driver";
import type { ScriptedDriverDeps } from "./scripted-driver";
import { missingRuntimeDetail } from "./vendor-process";

export interface ResolveAgentDriverArgs {
  config: Pick<AppConfig, "agent" | "agentModels" | "vaultDir">;
  db: DbConnection;
  notifier: DbNotifier;
  vault: VaultRuntime;
  sink: ProviderEventSink;
  // a getter, read per session open, so a Settings edit reaches the next session without a reboot.
  sessionFacts: () => AgentSessionFacts;
  // the stored choice, read per thread start for the same reason; null falls back to claude
  preferredProviderId?: () => HarnessId | null;
  env?: NodeJS.ProcessEnv;
  // absent: the runtime forks each adapter with child_process
  spawnAdapter?: AcpAgentRuntimeOptions["spawnAdapter"];
  // the ACP frames each adapter trades; the scripted driver speaks none.
  debugLog?: DebugLog | undefined;
}

export interface ResolvedAgentDriver {
  // read per request: a runtime removed from under a running app is the next answer.
  status: () => AgentStatus;
  driver: TurnDriver;
}

export const defaultHarnessId = (preferred: HarnessId | null): HarnessId => preferred ?? "claude";

const missingRuntime = (id: HarnessId, env: NodeJS.ProcessEnv): string | null => {
  const harness = HARNESSES[id];
  return harness.vendorExecutable(env) === null ? missingRuntimeDetail(harness) : null;
};

export const resolveAgentDriver = (args: ResolveAgentDriverArgs): ResolvedAgentDriver => {
  const mode = args.config.agent;
  if (mode === "off") {
    const detail = "The agent is disabled (INTELIGIR_AGENT=off)";
    return { driver: createUnavailableTurnDriver(detail), status: () => ({ mode }) };
  }
  const onDebug = createBoundedAgentLog();
  if (mode === "scripted") {
    const scripted: ScriptedDriverDeps = {
      git: args.vault.git,
      notifier: args.notifier,
      onError: onDebug,
      vault: args.vault.service,
    };
    return { driver: new ScriptedTurnDriver(args.sink, scripted), status: () => ({ mode }) };
  }

  const env = args.env ?? process.env;
  const defaultProviderId = (): HarnessId => defaultHarnessId(args.preferredProviderId?.() ?? null);
  const acp: AcpTurnDriverDeps = {
    db: args.db,
    debugLog: args.debugLog,
    defaultProviderId,
    git: args.vault.git,
    hostEnv: env,
    models: args.config.agentModels,
    notifier: args.notifier,
    onDebug,
    sessionFacts: args.sessionFacts,
    unavailableReason: (id) => missingRuntime(id, env),
    vaultDir: args.config.vaultDir,
  };
  if (args.spawnAdapter !== undefined) {
    acp.spawnAdapter = args.spawnAdapter;
  }
  return {
    driver: new AcpTurnDriver(args.sink, acp),
    // the harness a new thread would start on.
    status: () => {
      const detail = missingRuntime(defaultProviderId(), env);
      return detail === null
        ? { mode, runtime: "ready" }
        : { detail, mode, runtime: "unavailable" };
    },
  };
};
