// binary presence is read per call, never once at boot: a CLI installed after launch serves the next
// send, and with none on PATH a send fails synchronously rather than wedging a thread on an async
// spawn failure.

import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/domain/notifier";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import type { CreateTurnDriver } from "../threads/turn-driver";
import { createUnavailableTurnDriver } from "../threads/turn-driver";
import type { AcpMcpServerConfig } from "@repo/agent-runtime/acp/acp-runtime";
import { HARNESSES, HARNESS_IDS } from "@repo/agent-runtime/acp/harness-registry";
import type { HarnessId } from "@repo/agent-runtime/acp/harness-registry";
import type { AppConfig } from "../config";
import type { VaultRuntime } from "../vault/vault-runtime";
import { createBoundedAgentLog } from "./agent-log";
import type { AgentSessionFacts } from "./agent-shell-env";
import { binaryOnPath } from "./binary-on-path";
import { createAcpRuntimeManager } from "./runtime-manager";
import type { AcpRuntimeManagerDeps } from "./runtime-manager";
import { createScriptedTurnDriverFactory } from "./scripted-driver";
import type { ScriptedDriverDeps } from "./scripted-driver";

export interface ResolveAgentDriverArgs {
  config: Pick<AppConfig, "agent" | "agentModels" | "vaultDir">;
  mcpServers: () => AcpMcpServerConfig[] | Promise<AcpMcpServerConfig[]>;
  db: DbConnection;
  notifier: DbNotifier;
  vault: VaultRuntime;
  // a getter, read per session open, so a Settings edit reaches the next session without a reboot.
  sessionFacts: () => AgentSessionFacts;
  // the stored choice, read per thread start for the same reason; null falls back to what PATH holds
  preferredProviderId?: () => HarnessId | null;
  env?: NodeJS.ProcessEnv;
}

// a write the agent made through the server rather than its own tools, named by the thread whose
// shell sent it; a thread with no turn running records nothing.
export type RecordAgentWrites = (threadId: string, paths: readonly string[]) => void;

export interface ResolvedAgentDriver {
  // read per request: an install or an uninstall after boot is the next answer.
  status: () => AgentStatus;
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

const NO_AGENT_CLI =
  "No agent CLI was found on PATH — install Claude Code or the Codex CLI, or set INTELIGIR_AGENT=scripted";

export const availableHarnesses = (env: NodeJS.ProcessEnv): HarnessId[] =>
  HARNESS_IDS.filter((id) => binaryOnPath(HARNESSES[id].vendorBinary, env) !== null);

export const defaultHarnessId = (preferred: HarnessId | null, env: NodeJS.ProcessEnv): HarnessId =>
  preferred ?? availableHarnesses(env)[0] ?? HARNESS_IDS[0];

export const resolveAgentDriver = (args: ResolveAgentDriverArgs): ResolvedAgentDriver => {
  const mode = args.config.agent;
  if (mode === "off") {
    const detail = "The agent is disabled (INTELIGIR_AGENT=off)";
    return {
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
      onError: onDebug,
      vault: args.vault.service,
    };
    return {
      createTurnDriver: createScriptedTurnDriverFactory(scripted),
      dispose: noDispose,
      recordAgentWrites: recordNothing,
      status: () => ({ detail: null, mode, runtime: "scripted" }),
    };
  }

  const env = args.env ?? process.env;
  const unavailableReason = (): string | null =>
    availableHarnesses(env).length === 0 ? NO_AGENT_CLI : null;
  const acp: AcpRuntimeManagerDeps = {
    db: args.db,
    defaultProviderId: () => defaultHarnessId(args.preferredProviderId?.() ?? null, env),
    git: args.vault.git,
    hostEnv: env,
    mcpServers: args.mcpServers,
    models: args.config.agentModels,
    notifier: args.notifier,
    onDebug,
    sessionFacts: args.sessionFacts,
    unavailableReason,
    vaultDir: args.config.vaultDir,
  };
  const manager = createAcpRuntimeManager(acp);
  return {
    createTurnDriver: manager.createTurnDriver,
    dispose: async () => {
      await manager.dispose();
    },
    recordAgentWrites: manager.recordAgentWrites,
    status: () => {
      const detail = unavailableReason();
      return detail === null
        ? { detail: null, mode, runtime: "acp" }
        : { detail, mode, runtime: "unavailable" };
    },
  };
};
