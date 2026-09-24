import { getLiveEditor } from "@repo/editor/live-editor";
import { readFrontmatterRaw, writeFrontmatterRaw } from "@repo/editor/properties/properties-node";
import { frontmatterYamlWithId, mintNoteId } from "@repo/notes/markdown/frontmatter";

// An action binds to its note by the note's frontmatter id. The open note takes one the way a pin
// lands, through the live editor's frontmatter node, so the flush that names a view context's
// revision carries it and the server finds it there. Minted by the server instead, it would land
// under the buffer after the revision was taken. Frontmatter that cannot take an id is left for
// the server to refuse the same way.
export const ensureOpenNoteId = (path: string): void => {
  const editor = getLiveEditor(path);
  if (editor === null) {
    return;
  }
  const verdict = frontmatterYamlWithId(readFrontmatterRaw(editor), mintNoteId());
  if (verdict.kind === "written") {
    writeFrontmatterRaw(editor, verdict.yaml);
  }
};
