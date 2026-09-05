import type { SlateEditor } from "platejs";

import { toast } from "@repo/ui/components/sonner";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { splitFrontmatter } from "@repo/notes/markdown/frontmatter";
import { expandTemplate } from "@repo/notes/templates/placeholders";

import { getEditorHostIo } from "@repo/editor/host-io";
import { insertMarkdownAtSelection } from "@repo/editor/insert-markdown";
import { liveEditorPath } from "@repo/editor/live-editor";

// the one insert both the slash menu and the palette run, so a refusal has one wording. the
// template's frontmatter stays behind: properties belong to the note, not to the cursor.
export async function insertTemplate(editor: SlateEditor, templatePath: string): Promise<void> {
  let content: string;
  try {
    content = await getEditorHostIo().readVaultFile({ path: templatePath });
  } catch {
    toast.error("Could not read the template.");
    return;
  }
  const path = liveEditorPath(editor);
  const title = path === null ? "" : docStem(path);
  const { body } = splitFrontmatter(expandTemplate(content, { now: new Date(), title }));
  if (!insertMarkdownAtSelection(editor, body)) {
    toast.error("That template could not be parsed.");
  }
}
