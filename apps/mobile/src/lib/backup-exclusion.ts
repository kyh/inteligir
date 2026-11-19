import { requireNativeModule } from "expo";

interface BackupExclusionModule {
  excludeFromBackup: (directory: string) => Promise<void>;
}

export const excludeFromBackup = async (directory: string) => {
  await requireNativeModule<BackupExclusionModule>("BackupExclusion").excludeFromBackup(directory);
};
