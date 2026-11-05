// CLAUDE.md § THE TAB SENDS WHAT IT HOLDS UNTIL IT CLOSES, AND ASKS BEFORE LOSING IT. What this
// tab changed lives only in its memory until the cell takes it, so while any of it is held the
// browser asks before the tab closes, reloads or goes elsewhere. The listener is there only while
// something is held, as MDN advises, since it keeps the page from the back-forward cache
// (https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event).

import type { ReplicaStatus } from "@repo/library-replica/library-replica";

export interface LeaveGuard {
  // a holder of changes not yet sent, asked again each time it says it moved; answers its release
  readonly hold: (holding: () => boolean, onMove: (moved: () => void) => () => void) => () => void;
  // the page leaves on purpose, with nothing left it could send (a session that ended)
  readonly drop: () => void;
}

// the replica holds writes the cell has not taken, unless its session ended: those can no longer
// be sent, and the page is on its way to the sign-in
export const replicaHolds = (status: ReplicaStatus): boolean =>
  status.unsent > 0 && status.failure?.kind !== "session";

// preventDefault alone asks in every browser the page runs in (Chrome and Edge since 119)
const ask = (event: Event): void => {
  event.preventDefault();
};

export const createLeaveGuard = (
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
): LeaveGuard => {
  const holders = new Set<() => boolean>();
  let armed = false;
  let dropped = false;

  const judge = (): void => {
    const holds = !dropped && [...holders].some((holding) => holding());
    if (holds && !armed) {
      target.addEventListener("beforeunload", ask);
      armed = true;
    } else if (!holds && armed) {
      target.removeEventListener("beforeunload", ask);
      armed = false;
    }
  };

  return {
    drop: () => {
      dropped = true;
      judge();
    },
    hold: (holding, onMove) => {
      holders.add(holding);
      const stop = onMove(judge);
      judge();
      return () => {
        stop();
        holders.delete(holding);
        judge();
      };
    },
  };
};
