// Boot-time driver resolution: INTELIGIR_AGENT decides which TurnDriver the
// ThreadService is built with, and the decision (mode, what actually runs,
// why not) is the `agent` block of /system/status — so a 503 on send is
// diagnosable without reading logs. Binary presence is checked HERE, once,
// so an absent codex fails the send synchronously with an actionable
// message instead of wedging a thread on an async spawn failure.

import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/db/notifier";
import type { AgentStatus } from "@repo/server-contract/routes";
import type { CreateTurnDriver } from "../threads/turn-driver";
import { createUnavailableTurnDriver } from "../threads/turn-driver";
import type { AppConfig } from "../config";
import type { VaultRuntime } from "../vault/vault-runtime";
import { createCodexRuntimeManager } from "./runtime-manager";
import { createScriptedTurnDriverFactory } from "./scripted-driver";

export interface ResolveAgentDriverArgs {
  config: Pick<AppConfig, "agent" | "agentModel" | "vaultDir">;
  db: DbConnection;
  notifier: DbNotifier;
  vault: VaultRuntime;
  env?: NodeJS.ProcessEnv;
  onDebug?: (message: string) => void;
}

export interface ResolvedAgentDriver {
  status: AgentStatus;
  createTurnDriver: CreateTurnDriver;
  dispose(): Promise<void>;
}

export function codexBinaryOnPath(env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? "";
  for (const dir of pathValue.split(delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    const candidate = join(dir, "codex");
    try {
      if (!statSync(candidate).isFile()) {
        continue;
      }
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
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
  if (mode === "scripted") {
    return {
      status: { mode, runtime: "scripted", detail: null },
      createTurnDriver: createScriptedTurnDriverFactory({
        vault: args.vault.service,
        git: args.vault.git,
        ...(args.onDebug !== undefined ? { onError: args.onDebug } : {}),
      }),
      dispose: noDispose,
    };
  }

  const binary = codexBinaryOnPath(args.env ?? process.env);
  if (binary === null) {
    const detail =
      "The codex binary was not found on PATH — install the Codex CLI, or set INTELIGIR_AGENT=scripted";
    return {
      status: { mode, runtime: "unavailable", detail },
      createTurnDriver: () => createUnavailableTurnDriver(detail),
      dispose: noDispose,
    };
  }

  const manager = createCodexRuntimeManager({
    db: args.db,
    notifier: args.notifier,
    vaultDir: args.config.vaultDir,
    git: args.vault.git,
    model: args.config.agentModel,
    ...(args.onDebug !== undefined ? { onDebug: args.onDebug } : {}),
  });
  return {
    status: { mode, runtime: "codex", detail: null },
    createTurnDriver: manager.createTurnDriver,
    dispose: () => manager.dispose(),
  };
}
