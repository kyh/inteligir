import type { ContractRouterClient } from "@orpc/contract";

import type { LocalContract } from "../local-contract";
import type { VaultDeletedEntry } from "./vault-schema";

// what came back, and why each other file did not: "exists", something stands at its path now;
// "too-large", its bytes are over the cap; "gone", its revision no longer holds it; "failed", any
// other refusal
export interface HeldFilesRestore {
  restored: string[];
  failed: { path: string; reason: "exists" | "too-large" | "gone" | "failed" }[];
}

type VaultClient = ContractRouterClient<LocalContract>["vault"];

// The files a deleted doc held, restored with it, run by every client after the doc's own
// restore: one `revisionBytes` read and one `createFile` per file, so each is its own CAS and one
// that fails never stops the rest.
// PIVOT-STUB(S2): replaced by one revisionBytes + createFile per held file (§2.12)
export const restoreHeldFiles = (
  _api: { vault: Pick<VaultClient, "revisionBytes" | "createFile"> },
  _held: readonly VaultDeletedEntry[],
): Promise<HeldFilesRestore> => Promise.resolve({ failed: [], restored: [] });
