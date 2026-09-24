// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// the only place the native @parcel/watcher addon runs; a stuck one is sigkilled and respawned.

import fs from "node:fs/promises";
import parcelWatcher from "@parcel/watcher";
import { attachedPort, readParentPort } from "../../child-host/message-port";
import type { MessagePortLike } from "../../child-host/message-port";
import { parentToChildMessageSchema } from "./messages";
import type { ChildToParentMessage, ParentToChildMessage } from "./messages";
import { createParcelChildHandler } from "./parcel-child-handler";

// the way back to the server: node's ipc channel when node forked this child, or the port main
// handed it when the desktop shell's main forked it for the server.
interface ParentLink {
  send: (message: ChildToParentMessage) => void;
  onMessage: (listener: (message: ParentToChildMessage) => void) => void;
  onDisconnect: (listener: () => void) => void;
  start: () => void;
}

const ipcLink: ParentLink = {
  onDisconnect: (listener) => {
    process.on("disconnect", listener);
  },
  onMessage: (listener) => {
    process.on("message", (message) => {
      const parsed = parentToChildMessageSchema.safeParse(message);
      if (parsed.success) {
        listener(parsed.data);
      }
    });
  },
  send: (message) => {
    process.send?.(message);
  },
  start: () => {
    /* empty */
  },
};

const portLink = (port: MessagePortLike): ParentLink => ({
  onDisconnect: (listener) => {
    port.on("close", listener);
  },
  onMessage: (listener) => {
    port.on("message", ({ data }) => {
      const parsed = parentToChildMessageSchema.safeParse(data);
      if (parsed.success) {
        listener(parsed.data);
      }
    });
  },
  send: (message) => {
    port.postMessage(message);
  },
  start: () => {
    port.start();
  },
});

const parentPort = readParentPort();
const link = parentPort === null ? ipcLink : portLink(await attachedPort(parentPort));

const handler = createParcelChildHandler({
  listEntries: async (dir) => await fs.readdir(dir),
  parcel: parcelWatcher,
  send: link.send,
});

link.onMessage((message) => {
  handler.handleMessage(message);
});

const DISPOSE_TIMEOUT_MS = 2000;

const disposeThenExit = async (): Promise<void> => {
  try {
    await handler.dispose();
  } finally {
    process.exit(0);
  }
};

link.onDisconnect(() => {
  // bounded: a wedged native unsubscribe must not orphan this child.
  const deadline = setTimeout(() => process.exit(0), DISPOSE_TIMEOUT_MS);
  deadline.unref?.();
  void disposeThenExit();
});

link.start();
link.send({ kind: "ready" });
