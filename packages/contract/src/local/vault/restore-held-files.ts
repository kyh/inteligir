import { isDefinedError, safe } from "@orpc/client";

import type { LocalClient } from "../local-contract";
import type { VaultDeletedEntry } from "./vault-schema";

// what came back, and why each other file did not: "exists", something stands at its path now;
// "too-large", its bytes are over the cap; "gone", its revision no longer holds it; "failed", any
// other refusal
export interface HeldFilesRestore {
  restored: string[];
  failed: { path: string; reason: "exists" | "too-large" | "gone" | "failed" }[];
}

type VaultClient = LocalClient["vault"];

type Refusal = HeldFilesRestore["failed"][number]["reason"];

// each declared refusal of the two calls, by its code; "other" is a refusal no row declares
const READ_REFUSALS = {
  NOT_FOUND: "gone",
  other: "failed",
  PAYLOAD_TOO_LARGE: "too-large",
} as const satisfies Record<string, Refusal>;

const CREATE_REFUSALS = {
  ALREADY_EXISTS: "exists",
  CONFLICT: "failed",
  INVALID_PATH: "failed",
  other: "failed",
  PAYLOAD_TOO_LARGE: "too-large",
} as const satisfies Record<string, Refusal>;

// The files a deleted doc held, restored with it, run by every client after the doc's own
// restore: one `revisionBytes` read and one `createFile` per file, so each is its own CAS and one
// that fails never stops the rest. A file is created only where nothing stands: one put back
// there since is the person's, and stays.
export const restoreHeldFiles = async (
  api: { vault: Pick<VaultClient, "revisionBytes" | "createFile"> },
  held: readonly VaultDeletedEntry[],
): Promise<HeldFilesRestore> => {
  const outcome: HeldFilesRestore = { failed: [], restored: [] };
  for (const entry of held) {
    const read = await safe(api.vault.revisionBytes({ path: entry.path, sha: entry.sha }));
    if (read.error !== null) {
      const code = isDefinedError(read.error) ? read.error.code : null;
      outcome.failed.push({ path: entry.path, reason: READ_REFUSALS[code ?? "other"] });
      continue;
    }
    const created = await safe(api.vault.createFile({ file: read.data, path: entry.path }));
    if (created.error !== null) {
      const code = isDefinedError(created.error) ? created.error.code : null;
      outcome.failed.push({ path: entry.path, reason: CREATE_REFUSALS[code ?? "other"] });
      continue;
    }
    outcome.restored.push(created.data.path);
  }
  return outcome;
};
