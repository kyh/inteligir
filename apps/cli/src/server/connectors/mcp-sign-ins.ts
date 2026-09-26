// a connector's sign-in is the vendor's own `mcp login`, left running while the person finishes it
// in the browser: one per harness and name, since a second would race the first for one callback,
// and each ended by its window, its row's removal or the server's shutdown, every one of which
// kills the vendor process rather than leave it waiting on a browser that is not coming back.

import type { HarnessId } from "@repo/agent-runtime/acp/harness-registry";
import type { ConnectorSignIn } from "@repo/api/local/connectors/connectors-schema";
import { messageOf } from "../error-message";

// long enough to finish in a browser, short enough that one walked away from ends.
const MCP_SIGN_IN_WINDOW_MS = 5 * 60_000;

// stopped: something here ended it, which the registry tells apart itself.
export type McpSignInEnd =
  | { kind: "signed-in" }
  | { kind: "failed"; detail: string }
  | { kind: "stopped" };

export interface McpSignInRun {
  stop: () => void;
  // the address the vendor printed for a browser that did not open, once it has.
  authUrl: () => string | null;
  ended: Promise<McpSignInEnd>;
}

export interface McpSignIns {
  state: (harness: HarnessId, name: string) => ConnectorSignIn;
  running: (harness: HarnessId, name: string) => boolean;
  // takes over a run already going, for its window.
  adopt: (harness: HarnessId, name: string, run: McpSignInRun) => void;
  // ends a running sign-in with its vendor process, and forgets what the last one said.
  forget: (harness: HarnessId, name: string) => Promise<void>;
  dispose: () => Promise<void>;
}

export interface CreateMcpSignInsArgs {
  windowMs?: number;
}

interface Pending {
  kind: "pending";
  run: McpSignInRun;
  timer: ReturnType<typeof setTimeout>;
  expired: boolean;
}

type Entry = Pending | { kind: "failed"; detail: string };

const keyOf = (harness: HarnessId, name: string): string => JSON.stringify([harness, name]);

export const createMcpSignIns = (args: CreateMcpSignInsArgs = {}): McpSignIns => {
  const windowMs = args.windowMs ?? MCP_SIGN_IN_WINDOW_MS;
  const entries = new Map<string, Entry>();
  let disposed = false;

  const settle = async (key: string, pending: Pending): Promise<void> => {
    let end: McpSignInEnd;
    try {
      end = await pending.run.ended;
    } catch (error) {
      end = { detail: messageOf(error), kind: "failed" };
    }
    clearTimeout(pending.timer);
    // forgotten, or taken over by a newer one: neither is this run's to answer for.
    if (entries.get(key) !== pending) {
      return;
    }
    switch (end.kind) {
      case "signed-in": {
        entries.delete(key);
        break;
      }
      case "failed": {
        entries.set(key, { detail: end.detail, kind: "failed" });
        break;
      }
      case "stopped": {
        if (pending.expired) {
          entries.set(key, {
            detail: "The sign-in was not finished in time. Sign in again.",
            kind: "failed",
          });
        } else {
          entries.delete(key);
        }
        break;
      }
      // no default
    }
  };

  return {
    adopt: (harness, name, run) => {
      if (disposed) {
        run.stop();
        return;
      }
      const key = keyOf(harness, name);
      const pending: Pending = {
        expired: false,
        kind: "pending",
        run,
        timer: setTimeout(() => {
          pending.expired = true;
          run.stop();
        }, windowMs),
      };
      entries.set(key, pending);
      void settle(key, pending);
    },
    dispose: async () => {
      disposed = true;
      const running = [...entries.values()].flatMap((entry) =>
        entry.kind === "pending" ? [entry] : [],
      );
      entries.clear();
      for (const pending of running) {
        clearTimeout(pending.timer);
        pending.run.stop();
      }
      await Promise.allSettled(running.map(async (pending) => await pending.run.ended));
    },
    forget: async (harness, name) => {
      const key = keyOf(harness, name);
      const entry = entries.get(key);
      entries.delete(key);
      if (entry?.kind === "pending") {
        clearTimeout(entry.timer);
        entry.run.stop();
        await Promise.allSettled([entry.run.ended]);
      }
    },
    running: (harness, name) => entries.get(keyOf(harness, name))?.kind === "pending",
    state: (harness, name) => {
      const entry = entries.get(keyOf(harness, name));
      if (entry === undefined) {
        return { state: "idle" };
      }
      return entry.kind === "pending"
        ? { state: "pending", url: entry.run.authUrl() }
        : { detail: entry.detail, state: "failed" };
    },
  };
};
