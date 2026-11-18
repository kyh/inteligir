// The files of accounts that are gone, emptied from the store by hourly housekeeping
// (`../jobs/housekeeping`): an account's delete takes its rows alone, and an upload landing as it
// goes is kept under its folder after, so what is swept is the store's own folders, each whose
// account has no user row. The store paces each removal, and a folder the run's deadline or the
// store's rate leaves unfinished waits for the next run.

import { user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";

import { anyOf } from "../library/set-sql";
import { FILES_ROOT } from "./file-landing";
import { FILE_STORE } from "./file-store-of";

// The folders are listed before the accounts are read: a folder is made only once its account's row
// exists, so none listed belongs to an account too new to be read. Answers how many it emptied
export const emptyDeletedAccounts = async (deadline: number): Promise<number> => {
  const listed = await FILE_STORE.folders(FILES_ROOT);
  const folders = listed.map((folder) => ({
    accountId: folder.slice(FILES_ROOT.length, -1),
    folder,
  }));
  if (folders.length === 0) {
    return 0;
  }
  const live = await db
    .select({ id: user.id })
    .from(user)
    .where(
      anyOf(
        user.id,
        folders.map(({ accountId }) => accountId),
      ),
    );
  const liveIds = new Set(live.map(({ id }) => id));
  let emptied = 0;
  for (const { accountId, folder } of folders) {
    if (!liveIds.has(accountId)) {
      if ((await FILE_STORE.removePrefix(folder, deadline)) === "unfinished") {
        break;
      }
      emptied += 1;
    }
  }
  return emptied;
};
