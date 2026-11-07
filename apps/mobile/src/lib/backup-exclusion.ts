// iOS copies Documents into the phone's iCloud backup. What the replica holds downloads again from
// the account's library, so its database and the pinned files' folder are kept out (owner
// decision): a staged photo's outbox row lives in that database, so a backup would restore bytes
// nothing sends.
// The native half is modules/backup-exclusion, linked on iOS alone because the phone ships for
// iPhone only.

import { requireNativeModule } from "expo";

interface BackupExclusionModule {
  excludeFromBackup: (directory: string) => Promise<void>;
}

export const excludeFromBackup = async (directory: string): Promise<void> => {
  await requireNativeModule<BackupExclusionModule>("BackupExclusion").excludeFromBackup(directory);
};
