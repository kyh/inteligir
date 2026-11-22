import type { DbExecutor } from "@repo/db/drizzle-client";
import { setTimeout as sleep } from "node:timers/promises";

import { libraryHead } from "./library-rows";

const HEAD_POLL_MS = 1000;

export const libraryHeads: (
  db: DbExecutor,
  accountId: string,
  stop: AbortSignal,
  pollMs?: number,
) => AsyncGenerator<{ head: number }> = async function* libraryHeads(
  db: DbExecutor,
  accountId: string,
  stop: AbortSignal,
  pollMs = HEAD_POLL_MS,
) {
  let told: number | null = null;

  while (!stop.aborted) {
    const head = await libraryHead(db, accountId);

    if (head !== told) {
      told = head;
      yield { head };
    }

    await sleep(pollMs, undefined, { signal: stop }).catch(() => null);
  }
};
