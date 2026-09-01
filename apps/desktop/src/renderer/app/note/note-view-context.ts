// What the open note contributes to a message, framework-free so the ORDER
// below unit-tests: flush, then read, then hash.
//
// The flush is a requirement, not a nicety. The agent reads the file from
// disk, and up to a debounce of keystrokes (or a failed save) may not be there
// — so without it `revision` names bytes the user is not looking at, which
// makes the whole statement dishonest. It is the same `controller.flush()`
// gate a rename takes before the file moves.

import type { ViewContext } from "@repo/domain/view-context";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";

export interface OpenNoteView {
  /** Make the buffer durable. Rejection is the caller's own toast, not this
   *  seam's decision — see `readNoteViewContext`. */
  flush: () => Promise<void>;
  /** The buffer as the editor holds it. */
  read: () => { content: string };
}

/**
 * `revision` always hashes the BUFFER, which is what the user is actually
 * looking at — the flush is what usually makes disk agree with it. A flush
 * that fails is therefore not a reason to withhold the context: the mismatch
 * a failed save leaves is precisely what carrying a revision lets the agent
 * notice.
 */
export async function readNoteViewContext(path: string, view: OpenNoteView): Promise<ViewContext> {
  await view.flush().catch(() => {});
  const { content } = view.read();
  return {
    surface: "doc",
    resource: path,
    revision: await contentHashHex(content),
  };
}
