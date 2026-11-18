// Housekeeping, hourly by Vercel Cron (apps/web/vercel.json): change sets past Undo's reach, op
// answers past a resend's, then files nothing has named for a day, each in a transaction of its own
// so no account's lock is held past its own statements. Each passes over an account a write holds,
// which waits for the next run.

import { db } from "@repo/db/drizzle-client";

import { serveCron } from "../cron";
import { env } from "../env";
import { releaseUnnamedFiles } from "../files/file-release";
import { pruneChangeSets, pruneOpAnswers } from "../library/library-change-sets";

const runHousekeeping = async () => {
  const now = Date.now();
  return {
    changeSets: await db.transaction(async (tx) => await pruneChangeSets(tx, now)),
    files: await db.transaction(async (tx) => await releaseUnnamedFiles(tx, now)),
    opAnswers: await db.transaction(async (tx) => await pruneOpAnswers(tx, now)),
  };
};

export const serveHousekeeping = async (request: Request): Promise<Response> =>
  await serveCron(request, env.CRON_SECRET, runHousekeeping);
