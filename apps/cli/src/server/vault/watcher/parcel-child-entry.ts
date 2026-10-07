// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// the only place the native @parcel/watcher addon runs; a stuck one is sigkilled and respawned.

import fs from "node:fs/promises";
import parcelWatcher from "@parcel/watcher";
import { parentToChildMessageSchema } from "./messages";
import type { ChildToParentMessage, ParentToChildMessage } from "./messages";
import { createParcelChildHandler } from "./parcel-child-handler";

// the way back to the server is node's ipc channel: the server forked this child.
const link = {
  onDisconnect: (listener: () => void) => {
    process.on("disconnect", listener);
  },
  onMessage: (listener: (message: ParentToChildMessage) => void) => {
    process.on("message", (message) => {
      const parsed = parentToChildMessageSchema.safeParse(message);
      if (parsed.success) {
        listener(parsed.data);
      }
    });
  },
  send: (message: ChildToParentMessage) => {
    process.send?.(message);
  },
};

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

link.send({ kind: "ready" });
