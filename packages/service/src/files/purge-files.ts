// An account's files, let go from the store as the account is deleted, before its rows go: a
// failure aborts the deletion, and the account survives to retry. An upload still on its way lands
// after and expires by itself, since no settle finds the account.

import { accountFilesPrefix } from "./file-landing";
import { FILE_STORE } from "./file-store-of";

export const purgeFiles = async (accountId: string): Promise<void> => {
  await FILE_STORE.removePrefix(accountFilesPrefix(accountId));
};
