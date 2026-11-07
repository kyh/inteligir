// What the rail's footer says of the replica, in the person's words: whether the library here is
// caught up, still sending what was changed, waiting for a connection, holding a change the
// library refused, or stopped. Never the engine's own (a cursor, a head, an outbox), nor the words
// of a fault.

import type { ReplicaStatus } from "@repo/library-replica/library-replica";
import { plural } from "@repo/ui/lib/plural";

export type SyncTone = "quiet" | "busy" | "waiting" | "attention";

export interface SyncWords {
  readonly tone: SyncTone;
  readonly text: string;
}

export const syncWords = (status: ReplicaStatus, online: boolean): SyncWords => {
  const { failure } = status;
  if (failure?.kind === "session") {
    if (failure.end !== "outdated") {
      return { text: "Signed out. Sign in again to go on", tone: "attention" };
    }
    return {
      text:
        status.unsent > 0
          ? `Update Inteligir to send ${plural(status.unsent, "change")}`
          : "Update Inteligir to stay up to date",
      tone: "attention",
    };
  }
  if (status.parked.length > 0) {
    return {
      text: `${plural(status.parked.length, "change")} not saved`,
      tone: "attention",
    };
  }
  if (!online || failure?.kind === "unreachable") {
    return {
      text:
        status.unsent > 0
          ? `Waiting for a connection to send ${plural(status.unsent, "change")}`
          : "Waiting for a connection",
      tone: "waiting",
    };
  }
  if (failure?.kind === "busy") {
    return { text: "Busy for a moment. Trying again soon", tone: "waiting" };
  }
  if (failure !== null) {
    return { text: "Your library couldn't update. Trying again soon", tone: "attention" };
  }
  if (status.unsent > 0) {
    return { text: `Sending ${plural(status.unsent, "change")}…`, tone: "busy" };
  }
  if (status.syncing) {
    return { text: "Updating…", tone: "busy" };
  }
  return { text: "Up to date", tone: "quiet" };
};
