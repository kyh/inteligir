import type { ViewContext } from "@repo/domain/view-context";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";

export interface OpenNoteView {
  flush: () => Promise<void>;
  read: () => { content: string };
}

export async function readNoteViewContext(path: string, view: OpenNoteView): Promise<ViewContext> {
  // Flush first: the agent reads from disk, and a debounce of keystrokes may
  // not be there yet. A failed flush still answers — the revision hashes the
  // buffer, and the disk mismatch is what a revision lets the agent notice.
  await view.flush().catch(() => {});
  const { content } = view.read();
  return {
    surface: "doc",
    resource: path,
    revision: await contentHashHex(content),
  };
}
