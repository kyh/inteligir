// Runs once at boot over the whole tree, so a vault from before the store is clean after its
// first launch rather than note by note as each is opened. A sidecar with no note beside it, or
// one the service refuses, is left as found and named, never deleted.

import {
  isLegacyCommentsSidecarPath,
  legacySidecarNotePath,
} from "@repo/notes/comments/sidecar-schema";

import type { VaultService } from "../vault/vault-service";
import type { CommentsService } from "./comments-service";

export async function migrateLegacyCommentSidecars(args: {
  vault: VaultService;
  comments: CommentsService;
  warn: (message: string) => void;
}): Promise<number> {
  const { entries } = await args.vault.listTree();
  let migrated = 0;
  for (const entry of entries) {
    if (entry.kind !== "file" || !isLegacyCommentsSidecarPath(entry.path)) continue;
    const notePath = legacySidecarNotePath(entry.path);
    if ((await args.vault.statEntry(notePath)) !== "file") {
      args.warn(`${entry.path}: no note beside it; left as found`);
      continue;
    }
    try {
      if ((await args.comments.migrateLegacy(notePath)) === "migrated") migrated += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      args.warn(`${entry.path}: left as found; ${reason}`);
    }
  }
  return migrated;
}
