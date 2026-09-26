// whether an agent is signed in is the vendor's own answer, read through its bundled binary over the
// shared store (~/.claude, ~/.codex) a Mac already signed in keeps: a credential file or keychain
// entry existing says nothing about whether the vendor still accepts it.

import { HARNESSES } from "@repo/agent-runtime/acp/harness-registry";
import type { HarnessId, VendorAccount } from "@repo/agent-runtime/acp/harness-registry";
import { messageOf } from "../error-message";
import { runVendor } from "./vendor-process";
import type { VendorProcessContext } from "./vendor-process";

// claude-agent-acp bounds its own `claude auth status` probe the same way.
const PROBE_TIMEOUT_MS = 5000;
// Settings re-asks each time it opens; a vendor binary per open would be a process per click.
const FRESH_FOR_MS = 10_000;

export interface VendorAccounts {
  status: (id: HarnessId) => Promise<VendorAccount>;
  // a sign-in or sign-out this app drove: the next status asks the vendor again.
  invalidate: (id: HarnessId) => void;
}

export interface CreateVendorAccountsArgs extends VendorProcessContext {
  timeoutMs?: number;
}

interface Reading {
  answer: Promise<VendorAccount>;
  // infinite while the probe runs, so every caller meanwhile shares it.
  freshUntil: number;
}

export const createVendorAccounts = (args: CreateVendorAccountsArgs): VendorAccounts => {
  const timeoutMs = args.timeoutMs ?? PROBE_TIMEOUT_MS;
  const context: VendorProcessContext = { cwd: args.cwd, env: args.env };
  const readings = new Map<HarnessId, Reading>();

  const probe = async (id: HarnessId): Promise<VendorAccount> => {
    const harness = HARNESSES[id];
    try {
      const run = await runVendor(harness, harness.accountProbe.args, context, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      switch (run.kind) {
        case "exited": {
          return harness.accountProbe.read(run);
        }
        case "stopped": {
          return {
            detail: `${harness.displayName} did not answer within ${String(timeoutMs / 1000)}s`,
            state: "unknown",
          };
        }
        case "missing": {
          return {
            detail: `This copy of inteligir is missing its ${harness.displayName} runtime`,
            state: "unknown",
          };
        }
        case "failed": {
          return { detail: run.detail, state: "unknown" };
        }
        // no default
      }
    } catch (error) {
      return { detail: messageOf(error), state: "unknown" };
    }
  };

  return {
    invalidate: (id) => {
      readings.delete(id);
    },
    status: async (id) => {
      const held = readings.get(id);
      if (held !== undefined && Date.now() < held.freshUntil) {
        return await held.answer;
      }
      const reading: Reading = { answer: probe(id), freshUntil: Number.POSITIVE_INFINITY };
      readings.set(id, reading);
      const answer = await reading.answer;
      reading.freshUntil = Date.now() + FRESH_FOR_MS;
      return answer;
    },
  };
};
