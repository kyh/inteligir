// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// the only place the native @parcel/watcher addon runs; a stuck one is sigkilled and respawned.

import fs from "node:fs/promises";
import parcelWatcher from "@parcel/watcher";
import { parentToChildMessageSchema } from "./messages";
import { createParcelChildHandler } from "./parcel-child-handler";

const handler = createParcelChildHandler({
  listEntries: async (dir) => await fs.readdir(dir),
  parcel: parcelWatcher,
  send: (message) => {
    process.send?.(message);
  },
});

process.on("message", (message) => {
  const parsed = parentToChildMessageSchema.safeParse(message);
  if (parsed.success) {
    handler.handleMessage(parsed.data);
  }
});

const DISPOSE_TIMEOUT_MS = 2000;

const disposeThenExit = async (): Promise<void> => {
  try {
    await handler.dispose();
  } finally {
    process.exit(0);
  }
};

process.on("disconnect", () => {
  // bounded: a wedged native unsubscribe must not orphan this child.
  const deadline = setTimeout(() => process.exit(0), DISPOSE_TIMEOUT_MS);
  deadline.unref?.();
  void disposeThenExit();
});

process.send?.({ kind: "ready" });
