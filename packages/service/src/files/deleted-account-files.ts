import { user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";

import { anyOf } from "../library/set-sql";
import { FILES_ROOT } from "./file-landing";
import { FILE_STORE } from "./file-store-of";

export const emptyDeletedAccounts = async (deadline: number) => {
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
