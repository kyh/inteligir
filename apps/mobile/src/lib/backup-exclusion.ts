// iOS copies Documents into the phone's iCloud backup. The phone's key-value store holds the
// cache of what it read, which reads again from the account's library, and the shares waiting,
// which a restore onto another phone would send under nobody's sign-in, so it is kept out (owner
// decision).
// The native half is modules/backup-exclusion, linked on iOS alone because the phone ships for
// iPhone only.

import { requireNativeModule } from "expo";

interface BackupExclusionModule {
  excludeFromBackup: (directory: string) => Promise<void>;
}

export const excludeFromBackup = async (directory: string): Promise<void> => {
  await requireNativeModule<BackupExclusionModule>("BackupExclusion").excludeFromBackup(directory);
};
