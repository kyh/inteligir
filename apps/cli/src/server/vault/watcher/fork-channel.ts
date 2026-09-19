// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { childToParentMessageSchema } from "./messages";
import type { ParentToChildMessage } from "./messages";
import type { ChildChannel } from "./parcel-watcher-proxy";

// dev forks the .ts sibling: children inherit --import tsx via execArgv.
const resolveChildEntry = (): string => {
  const moduleDir = import.meta.dirname;
  // packaged: the .mjs sits beside the node bundle; dev: the .ts source.
  const candidates = ["parcel-watcher-child.mjs", "parcel-child-entry.ts"];
  for (const candidate of candidates) {
    const candidatePath = path.join(moduleDir, candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  throw new Error(
    `Watcher child entry not found in ${moduleDir} (looked for ${candidates.join(", ")})`,
  );
};

// nothing here may throw: the proxy pings from a bare setInterval, so an escaping ipc error is
// an uncaughtException. child.connected stays true while the channel tears down, so a ping
// racing a dying child fails with EPIPE; a failed send means the child is gone.
const createChildChannel = (child: ChildProcess): ChildChannel => {
  const exitListeners = new Set<() => void>();
  let gone = false;

  const markGone = (): void => {
    if (gone) {
      return;
    }
    gone = true;
    for (const listener of exitListeners) {
      listener();
    }
  };

  // the pipe broke but the process may live on holding inotify fds; sigkill so the os reclaims them.
  const abandon = (): void => {
    if (gone) {
      return;
    }
    child.kill("SIGKILL");
    markGone();
  };

  // without an error listener a spawn or kill failure is an unhandled 'error' event.
  child.on("error", markGone);
  child.on("exit", markGone);

  return {
    kill() {
      child.kill("SIGKILL");
    },
    onExit(listener) {
      exitListeners.add(listener);
    },
    onMessage(listener) {
      child.on("message", (message) => {
        const parsed = childToParentMessageSchema.safeParse(message);
        if (parsed.success) {
          listener(parsed.data);
        }
      });
    },
    send(message: ParentToChildMessage) {
      if (gone || !child.connected) {
        return;
      }
      try {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- ipc send reports a broken pipe only through its callback; this must stay synchronous and never throw.
        child.send(message, (error) => {
          if (error) {
            abandon();
          }
        });
      } catch {
        abandon();
      }
    },
  };
};

export const createForkChannel = (): ChildChannel =>
  createChildChannel(
    fork(resolveChildEntry(), [], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    }),
  );
