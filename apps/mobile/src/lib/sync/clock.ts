// ---------------------------------------------------------------------------
// Clock adapter — a filesystem-safe timestamp for @repo/core conflict-copy
// names. @repo/core stays clock-free; the platform supplies this. Mirrors the
// desktop's `nodeStamp()`: an ISO timestamp with `:` and `.` swapped for `-`, so
// the copy name is valid on every filesystem (Windows/exFAT reject `:`).
//
// Pure (no `expo-*` import), so the stamp format is unit-testable on node.
// ---------------------------------------------------------------------------

import type { Clock } from "@repo/core/sync/engine";

/** A filesystem-safe ISO-timestamp clock (`2026-07-05T12-34-56-000Z`). */
export function createFsStamp(now: () => Date = () => new Date()): Clock {
  return () => now().toISOString().replaceAll(":", "-").replace(".", "-");
}
