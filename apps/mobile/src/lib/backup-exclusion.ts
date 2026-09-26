// iOS copies Documents into the phone's iCloud backup. What the mirror holds downloads again from
// the hosted vault, so its directory is kept out (owner decision); the native half is
// modules/backup-exclusion, linked on iOS alone because the phone ships for iPhone only.

import { requireNativeModule } from "expo";
import { Platform } from "react-native";

interface BackupExclusionModule {
  excludeFromBackup: (directory: string) => Promise<void>;
}

export const excludeFromBackup = async (directory: string): Promise<void> => {
  if (Platform.OS !== "ios") {
    return;
  }
  await requireNativeModule<BackupExclusionModule>("BackupExclusion").excludeFromBackup(directory);
};
