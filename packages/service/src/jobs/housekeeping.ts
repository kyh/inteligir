// Housekeeping, hourly by Vercel Cron (apps/web/vercel.json): change sets past Undo's reach, op
// answers past a resend's, then files nothing has named for a day, each in a transaction of its own
// so no account's lock is held past its own statements, and each passing over an account a write
// holds, which waits for the next run. Then what assistants registered that no grant names, and
// last, deleted accounts' files are emptied from the store for what is left of the run.

import { db } from "@repo/db/drizzle-client";

import { pruneUnnamedRegistrations } from "../auth/connected-assistants";
import { serveCron } from "../cron";
import { env } from "../env";
import { emptyDeletedAccounts } from "../files/deleted-account-files";
import { releaseUnnamedFiles } from "../files/file-release";
import { pruneChangeSets, pruneOpAnswers } from "../library/library-change-sets";

// how long a run spends emptying deleted accounts' files, inside its route's 300 s
const STORE_SWEEP_MS = 240_000;

const runHousekeeping = async () => {
  const now = Date.now();
  const changeSets = await db.transaction(async (tx) => await pruneChangeSets(tx, now));
  const files = await db.transaction(async (tx) => await releaseUnnamedFiles(tx, now));
  const opAnswers = await db.transaction(async (tx) => await pruneOpAnswers(tx, now));
  const registrations = await pruneUnnamedRegistrations(now);
  const deletedAccounts = await emptyDeletedAccounts(now + STORE_SWEEP_MS);
  return { changeSets, deletedAccounts, files, opAnswers, registrations };
};

export const serveHousekeeping = async (request: Request): Promise<Response> =>
  await serveCron(request, env.CRON_SECRET, runHousekeeping);
