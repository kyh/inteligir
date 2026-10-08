// The seam a send runs through. This build carries no agent runtime: `auto`, the default, refuses
// a send synchronously with PROVIDER_UNAVAILABLE rather than wedging a thread, and `scripted` is
// the in-process fake the scenario suite drives.

import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/domain/notifier";
import type { AgentStatus } from "@repo/contract/local/system/system-schema";
import type { CreateTurnDriver } from "../threads/turn-driver";
import { createUnavailableTurnDriver } from "../threads/turn-driver";
import type { AppConfig } from "../config";
import { createInteractionWaiters } from "./interaction-waiters";
import { createScriptedTurnDriverFactory } from "./scripted-driver";

export interface ResolveAgentDriverArgs {
  config: Pick<AppConfig, "agent">;
  // where a driver's approvals are parked, and who hears them.
  db: DbConnection;
  notifier: DbNotifier;
}

export interface ResolvedAgentDriver {
  // read per request, so a runtime that comes or goes is the next answer.
  status: () => AgentStatus;
  createTurnDriver: CreateTurnDriver;
  dispose: () => Promise<void>;
}

export const NO_AGENT_RUNTIME = "No agent runtime yet: this build of inteligir cannot run a turn";
const AGENT_OFF = "The agent is disabled (INTELIGIR_AGENT=off)";

const noDispose = async (): Promise<void> => {
  await Promise.resolve();
};

const unavailable = (detail: string, status: AgentStatus): ResolvedAgentDriver => ({
  createTurnDriver: () => createUnavailableTurnDriver(detail),
  dispose: noDispose,
  status: () => status,
});

export const resolveAgentDriver = (args: ResolveAgentDriverArgs): ResolvedAgentDriver => {
  const mode = args.config.agent;
  switch (mode) {
    case "off": {
      return unavailable(AGENT_OFF, { detail: AGENT_OFF, mode, runtime: "off" });
    }
    case "scripted": {
      const { db, notifier } = args;
      let disposed = false;
      const waiters = createInteractionWaiters({
        db,
        debug: (message) => {
          console.warn(`scripted agent: ${message}`);
        },
        notifier,
      });
      return {
        createTurnDriver: createScriptedTurnDriverFactory({
          db,
          disposed: () => disposed,
          notifier,
          waiters,
        }),
        dispose: async () => {
          disposed = true;
          waiters.cancel();
          await Promise.resolve();
        },
        status: () => ({ detail: null, mode, runtime: "scripted" }),
      };
    }
    case "auto": {
      return unavailable(NO_AGENT_RUNTIME, {
        detail: NO_AGENT_RUNTIME,
        mode,
        runtime: "unavailable",
      });
    }
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
};
