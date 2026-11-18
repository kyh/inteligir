import type { RouterContractClient } from "@orpc/contract";

import { accountContract } from "./account-contract";
import { libraryContract } from "./library-contract";

export const V1_RPC_PATH = "/v1/rpc";

export const v1Contract = {
  account: accountContract,
  library: libraryContract,
};

type V1Contract = typeof v1Contract;

export type V1Client = RouterContractClient<V1Contract>;
