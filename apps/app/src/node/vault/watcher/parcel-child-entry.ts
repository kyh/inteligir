// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// Child process entry: the ONLY place the native @parcel/watcher addon runs.
// Any inotify EINTR leak/deadlock is contained here and reclaimed wholesale
// when the parent SIGKILLs and respawns us.

import fs from "node:fs/promises";
import parcelWatcher from "@parcel/watcher";
import { parentToChildMessageSchema } from "./messages";
import { createParcelChildHandler } from "./parcel-child-handler";

const handler = createParcelChildHandler({
  parcel: parcelWatcher,
  send: (message) => {
    process.send?.(message);
  },
  listEntries: (dir) => fs.readdir(dir),
});

process.on("message", (message) => {
  const parsed = parentToChildMessageSchema.safeParse(message);
  if (parsed.success) {
    handler.handleMessage(parsed.data);
  }
});

const DISPOSE_TIMEOUT_MS = 2_000;

process.on("disconnect", () => {
  // Bounded: a wedged native unsubscribe must not orphan this child — the
  // whole design assumes a stuck watcher dies and is respawned.
  const deadline = setTimeout(() => process.exit(0), DISPOSE_TIMEOUT_MS);
  deadline.unref?.();
  void handler.dispose().finally(() => process.exit(0));
});

process.send?.({ kind: "ready" });
