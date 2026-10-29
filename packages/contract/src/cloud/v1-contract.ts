// `/v1`'s one wire: every procedure the apps call, on one oRPC RPCHandler path. The Worker answers
// `account.*` itself and forwards `library.*` to the account's library cell, so a client holds one
// link and one error vocabulary for both. Bytes (`/v1/blobs/<sha>`) and the account's socket
// (`/v1/socket`) are the only routes beside it. A client ignores what it does not know, and the
// wire breaks only behind the client build floor (`client-build.ts`).

import type { RouterContractClient } from "@orpc/contract";

import { accountContract } from "./account/account-contract";
import { libraryContract } from "./library/library-contract";

export const V1_RPC_PATH = "/v1/rpc";

export const v1Contract = {
  account: accountContract,
  library: libraryContract,
};

type V1Contract = typeof v1Contract;

// what every app types its link against
export type V1Client = RouterContractClient<V1Contract>;
