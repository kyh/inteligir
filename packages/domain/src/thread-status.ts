// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";

export const threadStatusValues = ["idle", "starting", "active", "stopping", "error"] as const;
export const threadStatusSchema = z.enum(threadStatusValues);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export type RunningThreadStatus = Extract<ThreadStatus, "starting" | "active" | "stopping">;

// a turn is in flight, from its dispatch until it settles; a predicate, so a caller's switch over
// the settled rest stays exhaustive
export const isThreadRunning = (status: ThreadStatus): status is RunningThreadStatus => {
  switch (status) {
    case "starting":
    case "active":
    case "stopping": {
      return true;
    }
    case "idle":
    case "error": {
      return false;
    }
    // no default
  }
};

// what a Stop control offers: a turn to stop, a stop already requested, or nothing
export type ThreadStopControl = "stop" | "requested" | "none";

export const threadStopControlFor = (status: ThreadStatus): ThreadStopControl => {
  switch (status) {
    case "starting":
    case "active": {
      return "stop";
    }
    case "stopping": {
      return "requested";
    }
    case "idle":
    case "error": {
      return "none";
    }
    // no default
  }
};
