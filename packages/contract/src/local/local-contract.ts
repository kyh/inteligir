// both ends ship in one bundle, so this half may break freely; @repo/contract/cloud may never.

import { cloudContract } from "./cloud/cloud-contract";
import { systemContract } from "./system/system-contract";
import { threadsContract } from "./threads/threads-contract";

export const localContract = {
  cloud: cloudContract,
  system: systemContract,
  threads: threadsContract,
};

export type LocalContract = typeof localContract;
