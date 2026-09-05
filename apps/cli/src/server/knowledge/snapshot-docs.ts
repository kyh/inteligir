// The read half of every rewrite-set: snapshot each candidate before touching any, so the
// writes that follow can carry the bytes they were computed from (writeIfUnchanged). A doc
// the read refuses is skipped by name rather than failing the set.

import type { VaultRenameSkipReason } from "@repo/api/local/vault/vault-schema";
import { mapWithConcurrency } from "../concurrency";
import type { VaultService } from "../vault/vault-service";

const SNAPSHOT_CONCURRENCY = 8;

export interface DocSnapshots {
  docs: Map<string, string>;
  skipped: Array<{ path: string; reason: VaultRenameSkipReason }>;
}

export async function snapshotDocs(
  service: Pick<VaultService, "read">,
  candidates: readonly string[],
): Promise<DocSnapshots> {
  const snapshots = await mapWithConcurrency(candidates, SNAPSHOT_CONCURRENCY, async (candidate) =>
    service
      .read(candidate)
      .then((file) => file.content)
      .catch(() => null),
  );
  const docs = new Map<string, string>();
  const skipped: DocSnapshots["skipped"] = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    if (snapshot === null) {
      skipped.push({ path: candidate, reason: "unreadable" });
      continue;
    }
    docs.set(candidate, snapshot);
  }
  return { docs, skipped };
}
