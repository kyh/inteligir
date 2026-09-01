// Boot-time driver resolution: INTELIGIR_AGENT decides which TurnDriver the
// ThreadService is built with, and the decision (mode, what actually runs,
// why not) is the `agent` block of /system/status — so a 503 on send is
// diagnosable without reading logs. Binary presence is checked HERE, once,
// so an absent vendor CLI fails the send synchronously with an actionable
// message instead of wedging a thread on an async spawn failure.

import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/domain/notifier";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import type { CreateTurnDriver } from "../threads/turn-driver";
import { createUnavailableTurnDriver } from "../threads/turn-driver";
import type { AcpMcpServerConfig } from "@repo/agent-runtime/acp/acp-runtime";
import type { AppConfig } from "../config";
import type { VaultRuntime } from "../vault/vault-runtime";
import { createBoundedAgentLog } from "./agent-log";
import type { AgentSessionFacts } from "./agent-shell-env";
import { binaryOnPath } from "./binary-on-path";
import { createAcpRuntimeManager, type AcpRuntimeManagerDeps } from "./runtime-manager";
import { createScriptedTurnDriverFactory, type ScriptedDriverDeps } from "./scripted-driver";

export interface ResolveAgentDriverArgs {
  config: Pick<AppConfig, "agent" | "agentModel" | "vaultDir">;
  /** The enabled connector rows every session gets. */
  mcpServers: () => AcpMcpServerConfig[] | Promise<AcpMcpServerConfig[]>;
  db: DbConnection;
  notifier: DbNotifier;
  vault: VaultRuntime;
  /** What a session is told about this instance (agent-shell-env.ts); a
   *  getter, read fresh per session open so a Settings edit reaches the next
   *  session without a reboot. */
  sessionFacts: () => AgentSessionFacts;
  /** The environment the PATH probes read and the agent's shell extends; the
   *  tests' seam. */
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedAgentDriver {
  status: AgentStatus;
  createTurnDriver: CreateTurnDriver;
  dispose(): Promise<void>;
}

const noDispose = async (): Promise<void> => {};

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
  // The bounded log keeps a chatty provider VISIBLE without flooding: first
  // occurrence per stripped-id key logs in full, repeats log a count.
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

  // EITHER harness CLI on PATH boots the runtime; per-thread absence is the
  // registry's detect+guide to explain. The default harness is claude while
  // codex-acp 0.16.0 is live-broken upstream (its bundled core cannot parse
  // the current models response); codex stays selectable and heals on the
  // next adapter release — flip the default back then.
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
    defaultProviderId: claudeBinary === null ? "codex" : "claude",
    onDebug,
  };
  const manager = createAcpRuntimeManager(acp);
  return {
    status: { mode, runtime: "acp", detail: null },
    createTurnDriver: manager.createTurnDriver,
    dispose: () => manager.dispose(),
  };
}
