// the watcher child as the desktop shell runs it: main forks it through the broker, and the proxy
// talks to it over the port main handed both ends. the fork channel's rule holds: nothing here may
// throw, because the proxy pings from a bare setInterval.

import type { BrokeredFork, SignalProcess } from "../../child-host/fork-broker-client";
import type { MessagePortLike } from "../../child-host/message-port";
import { childToParentMessageSchema } from "./messages";
import type { ChildToParentMessage, ParentToChildMessage } from "./messages";
import type { ChildChannel } from "./parcel-watcher-proxy";

export const createPortChannel = (fork: BrokeredFork, signal: SignalProcess): ChildChannel => {
  const exitListeners = new Set<() => void>();
  const messageListeners = new Set<(message: ChildToParentMessage) => void>();
  let port: MessagePortLike | null = null;
  let pid: number | null = null;
  let killRequested = false;
  let gone = false;

  const markGone = (): void => {
    if (gone) {
      return;
    }
    gone = true;
    port = null;
    for (const listener of exitListeners) {
      listener();
    }
  };

  // sigkill, as the fork channel does: the os reclaims a wedged child's watches and threads.
  const killNow = (target: number): void => {
    try {
      signal(target, "SIGKILL");
    } catch {
      // already gone; main's exit report is on its way
    }
  };

  void (async () => {
    const attachment = await fork.attachment;
    if (attachment.kind === "failed") {
      markGone();
      return;
    }
    ({ pid } = attachment);
    if (killRequested || gone) {
      killNow(pid);
      return;
    }
    const attached = attachment.port;
    attached.on("message", ({ data }) => {
      const parsed = childToParentMessageSchema.safeParse(data);
      if (parsed.success && !gone) {
        for (const listener of messageListeners) {
          listener(parsed.data);
        }
      }
    });
    attached.on("close", markGone);
    port = attached;
    attached.start();
  })();

  void (async () => {
    await fork.exit;
    markGone();
  })();

  return {
    kill() {
      killRequested = true;
      if (pid !== null) {
        killNow(pid);
      }
    },
    onExit(listener) {
      exitListeners.add(listener);
    },
    onMessage(listener) {
      messageListeners.add(listener);
    },
    // before the port arrives nothing is listening: the proxy sends only once the child is ready.
    send(message: ParentToChildMessage) {
      if (gone || port === null) {
        return;
      }
      try {
        port.postMessage(message);
      } catch {
        if (pid !== null) {
          killNow(pid);
        }
        markGone();
      }
    },
  };
};
