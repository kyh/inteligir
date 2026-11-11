// What the page does about an edit it holds when it is about to go (CLAUDE.md § The tab asks
// before it loses the open item's edit): an edit not yet written lives only in its memory, so while
// one is held the browser asks before the tab closes, reloads or goes elsewhere. The listener is
// there only while something is held, as MDN advises, since it keeps the page from the
// back-forward cache (https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event).

// something the page holds that the cell has not taken yet
interface Held {
  // whether it holds anything now, asked again each time it says it moved
  readonly holding: () => boolean;
  readonly onMove: (moved: () => void) => () => void;
}

export interface LeaveGuard {
  // a holder of changes not yet kept; answers its release
  readonly hold: (held: Held) => () => void;
  // the page leaves on purpose, with nothing left it could send (a session that ended)
  readonly drop: () => void;
}

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
