// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childToParentMessageSchema, type ParentToChildMessage } from "./messages";
import type { ChildChannel } from "./parcel-watcher-proxy";

// dev forks the .ts sibling: children inherit --import tsx via execArgv.
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

// nothing here may throw: the proxy pings from a bare setInterval, so an escaping ipc error is
// an uncaughtException. child.connected stays true while the channel tears down, so a ping
// racing a dying child fails with EPIPE; a failed send means the child is gone.
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

  // the pipe broke but the process may live on holding inotify fds; sigkill so the os reclaims them.
  function abandon(): void {
    if (gone) {
      return;
    }
    child.kill("SIGKILL");
    markGone();
  }

  // without an error listener a spawn or kill failure is an unhandled 'error' event.
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
