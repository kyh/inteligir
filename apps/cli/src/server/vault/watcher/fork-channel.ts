// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childToParentMessageSchema, type ParentToChildMessage } from "./messages";
import type { ChildChannel } from "./parcel-watcher-proxy";

// Resolve the watcher child entry relative to this module's runtime location.
// In prod this file is bundled into dist-node/main.js and the child bundle
// (parcel-watcher-child.mjs, see scripts/build-node-entry.mjs) sits beside it.
// In dev this file runs from source, so the child is its `.ts` sibling —
// forked children inherit `--import tsx` via execArgv, so a `.ts` entry runs
// without extra wiring.
function resolveChildEntry(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    "parcel-watcher-child.mjs", // packaged: sibling of the node bundle
    "parcel-child-entry.ts", // dev source
  ];
  for (const candidate of candidates) {
    const candidatePath = join(moduleDir, candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  throw new Error(
    `Watcher child entry not found in ${moduleDir} (looked for ${candidates.join(", ")})`,
  );
}

/**
 * Adapt an already-forked child to the {@link ChildChannel} contract. Split out
 * from {@link createForkChannel} so the IPC failure paths can be exercised
 * without spawning a real process.
 *
 * Nothing here may throw. The proxy pings the child from a bare `setInterval`,
 * so an escaping IPC error becomes an `uncaughtException` that takes down the
 * whole server. A broken pipe is not even rare: `child.connected` stays true
 * while the channel is tearing down, so a ping racing a dying child fails with
 * EPIPE. That window yawns open exactly when the process is already
 * struggling, because a stalled event loop delays the timer past the child's
 * unprocessed `exit` event.
 *
 * A failed send therefore means "this child is gone", which is a condition the
 * proxy already recovers from: report it through the exit path and it kills,
 * respawns, and replays every subscription.
 */
function createChildChannel(child: ChildProcess): ChildChannel {
  const exitListeners = new Set<() => void>();
  let gone = false;

  function markGone(): void {
    if (gone) {
      return;
    }
    gone = true;
    for (const listener of exitListeners) {
      listener();
    }
  }

  // The pipe broke but the process may still be alive, holding the inotify fds
  // and threads its watches allocated. SIGKILL it so the OS reclaims them,
  // rather than leaking an orphan watcher per failure.
  function abandon(): void {
    if (gone) {
      return;
    }
    child.kill("SIGKILL");
    markGone();
  }

  // Without an `error` listener a spawn or kill failure is an unhandled
  // 'error' event, which is the same fatal outcome by another route.
  child.on("error", markGone);
  child.on("exit", markGone);

  return {
    send(message: ParentToChildMessage) {
      if (gone || !child.connected) {
        return;
      }
      try {
        child.send(message, (error) => {
          if (error) {
            abandon();
          }
        });
      } catch {
        abandon();
      }
    },
    onMessage(listener) {
      child.on("message", (message) => {
        const parsed = childToParentMessageSchema.safeParse(message);
        if (parsed.success) {
          listener(parsed.data);
        }
      });
    },
    onExit(listener) {
      exitListeners.add(listener);
    },
    kill() {
      child.kill("SIGKILL");
    },
  };
}

export function createForkChannel(): ChildChannel {
  return createChildChannel(
    fork(resolveChildEntry(), [], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    }),
  );
}
