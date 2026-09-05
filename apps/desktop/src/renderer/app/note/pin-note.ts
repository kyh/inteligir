import { getLiveEditor } from "@repo/editor/live-editor";
import { readFrontmatterRaw, writeFrontmatterRaw } from "@repo/editor/properties/properties-node";
import { pinnedFrontmatterYaml, setFrontmatterPinned } from "@repo/notes/markdown/frontmatter";
import { rewriteNote, type RewriteNoteApi } from "./rewrite-note";

export type PinNoteApi = RewriteNoteApi;

export type PinNoteOutcome =
  | { kind: "done" }
  | { kind: "unchanged" }
  | { kind: "refused"; message: string };

// One edit behind the panel, the tree and the palette. The open note takes it the way the
// properties panel writes, through the live editor's frontmatter node, so the buffer and the
// autosave carry it. Any other note goes through the guarded rewrite; a note that moved
// underneath is refused, never merged: a pin is one click to repeat.
export async function setNotePinned(
  api: RewriteNoteApi,
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
  // invalid YAML answers the same bytes with the verdict beside them, so nothing is written
  const outcome = await rewriteNote(api, path, (content) => {
    const next = setFrontmatterPinned(content, pinned);
    return next === null ? { content, result: "invalid" } : { content: next, result: "edited" };
  });
  switch (outcome.kind) {
    case "written":
      return { kind: "done" };
    case "unchanged":
      return outcome.result === "invalid"
        ? { kind: "refused", message: unreadable }
        : { kind: "unchanged" };
    case "changed":
      return {
        kind: "refused",
        message: `Could not ${verb} ${path}: it changed since it was read.`,
      };
    case "failed":
      return { kind: "refused", message: `Could not ${verb} ${path}: ${outcome.message}` };
  }
}
