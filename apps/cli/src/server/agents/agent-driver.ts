// binary presence is checked here, once: an absent vendor CLI then fails a send synchronously rather than
// wedging a thread on an async spawn failure.

import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/domain/notifier";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import type { CreateTurnDriver } from "../threads/turn-driver";
import { createUnavailableTurnDriver } from "../threads/turn-driver";
import type { AcpMcpServerConfig } from "@repo/agent-runtime/acp/acp-runtime";
import type { HarnessId } from "@repo/agent-runtime/acp/harness-registry";
import type { AppConfig } from "../config";
import type { VaultRuntime } from "../vault/vault-runtime";
import { createBoundedAgentLog } from "./agent-log";
import type { AgentSessionFacts } from "./agent-shell-env";
import { binaryOnPath } from "./binary-on-path";
import { createAcpRuntimeManager, type AcpRuntimeManagerDeps } from "./runtime-manager";
import { createScriptedTurnDriverFactory, type ScriptedDriverDeps } from "./scripted-driver";

export interface ResolveAgentDriverArgs {
  config: Pick<AppConfig, "agent" | "agentModel" | "vaultDir">;
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

export interface ResolvedAgentDriver {
  status: AgentStatus;
  createTurnDriver: CreateTurnDriver;
  dispose(): Promise<void>;
}

const noDispose = async (): Promise<void> => {};

// default harness is claude while codex-acp 0.16.0 is broken upstream (its bundled core cannot parse the
// current models response); flip the fallback back when the adapter heals.
export function defaultHarnessId(preferred: HarnessId | null, env: NodeJS.ProcessEnv): HarnessId {
  if (preferred !== null) return preferred;
  return binaryOnPath("claude", env) === null && binaryOnPath("codex", env) !== null
    ? "codex"
    : "claude";
}

export function resolveAgentDriver(args: ResolveAgentDriverArgs): ResolvedAgentDriver {
  const mode = args.config.agent;
  if (mode === "off") {
    const detail = "The agent is disabled (INTELIGIR_AGENT=off)";
    return {
      status: { mode, runtime: "off", detail },
      createTurnDriver: () => createUnavailableTurnDriver(detail),
      dispose: noDispose,
    };
  }
  const onDebug = createBoundedAgentLog();
  if (mode === "scripted") {
    const scripted: ScriptedDriverDeps = {
      vault: args.vault.service,
      git: args.vault.git,
      onError: onDebug,
    };
    return {
      status: { mode, runtime: "scripted", detail: null },
      createTurnDriver: createScriptedTurnDriverFactory(scripted),
      dispose: noDispose,
    };
  }

  const env = args.env ?? process.env;
  const claudeBinary = binaryOnPath("claude", env);
  const codexBinary = binaryOnPath("codex", env);
  if (claudeBinary === null && codexBinary === null) {
    const detail =
      "No agent CLI was found on PATH — install Claude Code or the Codex CLI, or set INTELIGIR_AGENT=scripted";
    return {
      status: { mode, runtime: "unavailable", detail },
      createTurnDriver: () => createUnavailableTurnDriver(detail),
      dispose: noDispose,
    };
  }

  const acp: AcpRuntimeManagerDeps = {
    db: args.db,
    notifier: args.notifier,
    vaultDir: args.config.vaultDir,
    git: args.vault.git,
    model: args.config.agentModel,
    mcpServers: args.mcpServers,
    sessionFacts: args.sessionFacts,
    hostEnv: env,
    defaultProviderId: () => defaultHarnessId(args.preferredProviderId?.() ?? null, env),
    onDebug,
  };
  const manager = createAcpRuntimeManager(acp);
  return {
    status: { mode, runtime: "acp", detail: null },
    createTurnDriver: manager.createTurnDriver,
    dispose: () => manager.dispose(),
  };
}
