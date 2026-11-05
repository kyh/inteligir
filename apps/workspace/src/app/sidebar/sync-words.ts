// What the rail's footer says of the replica, in the person's words: whether the library here is
// caught up, still sending what was changed, waiting for a connection, or holding a change the
// library refused. Never the engine's own (a cursor, a head, an outbox).

import type { ReplicaStatus } from "@repo/library-replica/library-replica";
import { plural } from "@repo/ui/lib/plural";

export type SyncTone = "quiet" | "busy" | "waiting" | "attention";

export interface SyncWords {
  readonly tone: SyncTone;
  readonly text: string;
}

export const syncWords = (status: ReplicaStatus, online: boolean): SyncWords => {
  if (status.parked.length > 0) {
    return {
      text: `${plural(status.parked.length, "change")} not saved`,
      tone: "attention",
    };
  }
  if (!online || status.failure?.kind === "unreachable") {
    return {
      text:
        status.unsent > 0
          ? `Waiting for a connection to send ${plural(status.unsent, "change")}`
          : "Waiting for a connection",
      tone: "waiting",
    };
  }
  if (status.failure?.kind === "busy") {
    return { text: "Busy for a moment. Trying again soon", tone: "waiting" };
  }
  if (status.unsent > 0) {
    return { text: `Sending ${plural(status.unsent, "change")}…`, tone: "busy" };
  }
  if (status.syncing) {
    return { text: "Updating…", tone: "busy" };
  }
  return { text: "Up to date", tone: "quiet" };
};
