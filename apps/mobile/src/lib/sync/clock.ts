// ---------------------------------------------------------------------------
// Clock adapter — a filesystem-safe timestamp for @repo/core conflict-copy
// names. @repo/core stays clock-free; the platform supplies the Date and
// core's `fsSafeStamp` owns the format (shared with the desktop's nodeStamp).
//
// Pure (no `expo-*` import), so the stamp format is unit-testable on node.
// ---------------------------------------------------------------------------

import type { Clock } from "@repo/core/sync/engine";
import { fsSafeStamp } from "@repo/core/sync/reconcile";

/** A filesystem-safe ISO-timestamp clock (`2026-07-05T12-34-56-000Z`). */
export function createFsStamp(now: () => Date = () => new Date()): Clock {
  return () => fsSafeStamp(now());
}
