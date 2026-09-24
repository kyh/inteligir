import type { ViewContext } from "@repo/domain/view-context";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";

export interface OpenNoteView {
  flush: () => Promise<void>;
  // null once another note replaced this one: its revision is no longer on screen to state.
  read: () => { content: string } | null;
}

export const readNoteViewContext = async (
  path: string,
  view: OpenNoteView,
): Promise<ViewContext | null> => {
  // Flush first: the agent reads from disk, and a debounce of keystrokes may
  // not be there yet. A failed flush still answers — the revision hashes the
  // buffer, and the disk mismatch is what a revision lets the agent notice.
  await view.flush().catch(() => {
    /* empty */
  });
  const shown = view.read();
  if (shown === null) {
    return null;
  }
  return {
    resource: path,
    revision: await contentHashHex(shown.content),
    surface: "doc",
  };
};
