// A tab's own read of its session, on the hour. Better Auth slides a session and its cookie
// together on that read alone, which the tab otherwise makes only as it opens, so a tab left open
// would lose its cookie seven days after its sign-in, however much it was used (`apps/web/CLAUDE.md`
// § ONLY BETTER AUTH'S OWN READ SLIDES A SESSION).

import type { Clock } from "@repo/contract/cloud/library/account-socket";

// well inside the day a session waits before it slides
/** @internal */
export const SESSION_READ_MS = 3_600_000;

export const keepSession = (clock: Clock, read: () => Promise<void>): void => {
  const readOnce = async (): Promise<void> => {
    try {
      await read();
    } catch {
      // the next read makes up for this one, and a session that ended meets the next `/v1` call
    }
  };
  clock.after(SESSION_READ_MS, () => {
    keepSession(clock, read);
    void readOnce();
  });
};
