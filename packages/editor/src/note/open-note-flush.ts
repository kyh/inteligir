// the shell's writers outside the note's own tree (a restore, an annotation, a send's view context)
// flush the open note through this module, over the installed host's flush; once that host's
// disposer runs there is nothing left to flush.

import { deferred } from "@repo/editor/deferred";
import { installedFlush } from "@repo/editor/host-io";

const FLUSH_TIMEOUT_MS = 5000;

// never rejects. the timeout bounds the caller's wait and does not abort the
// write, so a flush slow enough to time out can still land late.
export const flushOpenNote = async (): Promise<boolean> => {
  const flush = installedFlush();
  if (flush === null) {
    return true;
  }
  const timeout = deferred<boolean>();
  const timer = setTimeout(() => {
    timeout.resolve(false);
  }, FLUSH_TIMEOUT_MS);
  try {
    return await Promise.race([flush().catch(() => false), timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
};
