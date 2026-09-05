import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { getLiveEditor } from "@repo/editor/live-editor";
import { readFrontmatterRaw, writeFrontmatterRaw } from "@repo/editor/properties/properties-node";
import { pinnedFrontmatterYaml, setFrontmatterPinned } from "@repo/notes/markdown/frontmatter";
import { refusalMessage, safe, type client } from "../api";

export interface PinNoteApi {
  vault: Pick<(typeof client)["vault"], "read" | "write">;
}

export type PinNoteOutcome =
  | { kind: "done" }
  | { kind: "unchanged" }
  | { kind: "refused"; message: string };

// One edit behind the panel, the tree and the palette. The open note takes it the way the
// properties panel writes, through the live editor's frontmatter node, so the buffer and the
// autosave carry it. Any other note is read, edited and written back with the hash of what was
// read; a note that moved underneath is refused, never merged: a pin is one click to repeat.
export async function setNotePinned(
  api: PinNoteApi,
  path: string,
  pinned: boolean,
): Promise<PinNoteOutcome> {
  const verb = pinned ? "pin" : "unpin";
  const unreadable = `Could not ${verb} ${path}: its frontmatter is not valid YAML.`;
  const editor = getLiveEditor(path);
  if (editor !== null) {
    const verdict = pinnedFrontmatterYaml(readFrontmatterRaw(editor), pinned);
    if (verdict.kind === "invalid") return { kind: "refused", message: unreadable };
    if (verdict.kind === "unchanged") return { kind: "unchanged" };
    writeFrontmatterRaw(editor, verdict.yaml);
    return { kind: "done" };
  }
  const { content } = await api.vault.read({ path });
  const next = setFrontmatterPinned(content, pinned);
  if (next === null) return { kind: "refused", message: unreadable };
  if (next === content) return { kind: "unchanged" };
  const expectedHash = await contentHashHex(content);
  const { error } = await safe(api.vault.write({ path, content: next, expectedHash }));
  if (error !== null) {
    const reason = refusalMessage(error, "the write was refused");
    return { kind: "refused", message: `Could not ${verb} ${path}: ${reason}` };
  }
  return { kind: "done" };
}
