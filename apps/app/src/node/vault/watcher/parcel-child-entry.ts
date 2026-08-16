// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// Child process entry: the ONLY place the native @parcel/watcher addon runs.
// Any inotify EINTR leak/deadlock is contained here and reclaimed wholesale
// when the parent SIGKILLs and respawns us.

import fs from "node:fs/promises";
import parcelWatcher from "@parcel/watcher";
import { parseParentToChildMessage } from "./messages";
import { createParcelChildHandler } from "./parcel-child-handler";

const handler = createParcelChildHandler({
  parcel: parcelWatcher,
  send: (message) => {
    process.send?.(message);
  },
  listEntries: (dir) => fs.readdir(dir),
});

process.on("message", (message) => {
  const parsed = parseParentToChildMessage(message);
  if (parsed !== null) {
    handler.handleMessage(parsed);
  }
});

process.on("disconnect", () => {
  void handler.dispose().finally(() => process.exit(0));
});

process.send?.({ kind: "ready" });
