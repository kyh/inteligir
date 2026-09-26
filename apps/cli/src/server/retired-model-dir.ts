// dictation is the operating system's, so the speech model an older build downloaded into the data
// root (about 100 MB) is litter no build reads.

import { rm } from "node:fs/promises";
import path from "node:path";
import { physicalVaultDir } from "./config";
import type { AppConfig } from "./config";
import { pathContains } from "./path-containment";

const RETIRED_MODEL_DIR_NAME = "models";

type RetiredModelConfig = Pick<
  AppConfig,
  "dataDir" | "dataDirSource" | "mode" | "rootDataDir" | "vaultDir"
>;

// the installed app's own root alone: a pinned data dir is a harness's or an operator's, and a dev
// instance never reaches into the installed app's root. compared physically, because only a
// symlink can put the vault or the data dir under it, and a lexical check would pass that.
const retiredModelDir = (config: RetiredModelConfig): string | null => {
  if (config.mode !== "prod" || config.dataDirSource !== "default") {
    return null;
  }
  const dir = path.join(config.rootDataDir, RETIRED_MODEL_DIR_NAME);
  const physical = physicalVaultDir(dir);
  const vaultDir = physicalVaultDir(config.vaultDir);
  const holdsWhatStays =
    pathContains(physical, vaultDir) ||
    pathContains(physical, physicalVaultDir(config.dataDir)) ||
    pathContains(vaultDir, physical);
  return holdsWhatStays ? null : dir;
};

export const removeRetiredModelDir = async (config: RetiredModelConfig): Promise<void> => {
  const dir = retiredModelDir(config);
  if (dir !== null) {
    await rm(dir, { force: true, recursive: true });
  }
};
