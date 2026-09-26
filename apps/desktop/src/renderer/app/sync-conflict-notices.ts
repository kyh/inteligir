// A sync never stops to ask about an overlap, so this is where the user learns which version
// stayed and where the other went. Each report is said once, against the newest `at` already said:
// stored, so a reload says nothing again while a report the boot sync made before this window
// mounted is still said.

import type { VaultSyncConflict } from "@repo/api/local/vault/vault-schema";
import { describeSyncConflict } from "@repo/notes/sync/conflict-copy";
import { toast } from "@repo/ui/components/sonner";
import { useEffect, useEffectEvent } from "react";
import { PREFS, readPref, writePref } from "./prefs";
import { useVaultStatus } from "./vault-hooks";

const conflictOpenPath = (report: VaultSyncConflict): string =>
  report.kind === "copied" ? report.copyPath : report.path;

export const useSyncConflictNotices = (openNote: (path: string) => void): void => {
  const status = useVaultStatus().data;
  const open = useEffectEvent(openNote);
  useEffect(() => {
    if (status === undefined) {
      return;
    }
    const seenAt = readPref(PREFS.syncConflictSeenAt);
    // newest first on the wire; announced oldest first, so the newest lands on top of the stack
    const unseen = status.conflicts
      .filter((report) => seenAt === null || report.at > seenAt)
      .toReversed();
    const newest = unseen.at(-1);
    if (newest === undefined) {
      return;
    }
    writePref(PREFS.syncConflictSeenAt, newest.at);
    for (const report of unseen) {
      // kept until dismissed: a sentence that timed out while the user was typing is a copy they
      // never hear about
      toast.warning(describeSyncConflict(report, { thisDevice: status.device }), {
        action: {
          label: "Open",
          onClick: () => {
            open(conflictOpenPath(report));
          },
        },
        closeButton: true,
        duration: Infinity,
      });
    }
  }, [status]);
};
