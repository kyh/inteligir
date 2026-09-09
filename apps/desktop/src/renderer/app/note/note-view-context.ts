import type { ViewContext } from "@repo/domain/view-context";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";

export interface OpenNoteView {
  flush: () => Promise<void>;
  read: () => { content: string };
}

export const readNoteViewContext = async (
  path: string,
  view: OpenNoteView,
): Promise<ViewContext> => {
  // Flush first: the agent reads from disk, and a debounce of keystrokes may
  // not be there yet. A failed flush still answers — the revision hashes the
  // buffer, and the disk mismatch is what a revision lets the agent notice.
  await view.flush().catch(() => {
    /* empty */
  });
  const { content } = view.read();
  return {
    resource: path,
    revision: await contentHashHex(content),
    surface: "doc",
  };
};
