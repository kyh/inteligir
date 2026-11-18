import { db } from "@repo/db/drizzle-client";

import { pruneUnnamedRegistrations } from "../auth/connected-assistants";
import { serveCron } from "../cron";
import { env } from "../env";
import { emptyDeletedAccounts } from "../files/deleted-account-files";
import { releaseUnnamedFiles } from "../files/file-release";
import { pruneChangeSets, pruneOpAnswers } from "../library/library-prunes";

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

export const serveHousekeeping = async (request: Request) =>
  await serveCron(request, env.CRON_SECRET, runHousekeeping);
