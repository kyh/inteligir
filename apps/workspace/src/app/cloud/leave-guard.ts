// What the page does about the changes it holds when it is about to go, which each host does its
// own way. In the tab (CLAUDE.md § THE TAB SENDS WHAT IT HOLDS UNTIL IT CLOSES, AND ASKS BEFORE
// LOSING IT), what it changed lives only in its memory until the cell takes it, so while any of it
// is held the browser asks before the tab closes, reloads or goes elsewhere. The listener is there
// only while something is held, as MDN advises, since it keeps the page from the back-forward cache
// (https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event). The Mac's guard
// writes what is held instead, as the shell asks before it quits (`shell-library.ts`).

import type { ReplicaStatus } from "@repo/library-replica/library-replica";

// something the page holds that its host has not kept yet
export interface Held {
  // whether it holds anything now, asked again each time it says it moved
  readonly holding: () => boolean;
  readonly onMove: (moved: () => void) => () => void;
  // writes it where the host keeps it (the open item's edit, into the outbox), for a host that can
  // wait for that before the page goes; what only the cell can take has none
  readonly write?: () => Promise<void>;
}

export interface LeaveGuard {
  // a holder of changes not yet kept; answers its release
  readonly hold: (held: Held) => () => void;
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
  const holders = new Set<Held>();
  let armed = false;
  let dropped = false;

  const judge = (): void => {
    const holds = !dropped && [...holders].some((held) => held.holding());
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
    hold: (held) => {
      holders.add(held);
      const stop = held.onMove(judge);
      judge();
      return () => {
        stop();
        holders.delete(held);
        judge();
      };
    },
  };
};
