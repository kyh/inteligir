import type { SlateEditor } from "platejs";

import { toast } from "@repo/ui/components/sonner";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { splitFrontmatter } from "@repo/notes/markdown/frontmatter";
import { expandTemplate } from "@repo/notes/templates/placeholders";

import { getEditorHostIo } from "@repo/editor/host-io";
import { isLiveEditor, liveEditorPath } from "@repo/editor/live-editor";
import { mdToSlate } from "@repo/editor/markdown/md-to-slate";

// the one insert both the slash menu and the palette run, so a refusal has one wording. the
// template's frontmatter stays behind: properties belong to the note, not to the cursor.
export const insertTemplate = async (editor: SlateEditor, templatePath: string): Promise<void> => {
  let content: string;
  try {
    content = await getEditorHostIo().readVaultFile({ path: templatePath });
  } catch {
    toast.error("Could not read the template.");
    return;
  }
  const path = liveEditorPath(editor);
  if (path === null || !isLiveEditor(editor)) {
    toast.warning("The note closed before the template could be inserted.");
    return;
  }
  const { body } = splitFrontmatter(
    expandTemplate(content, { now: new Date(), title: docStem(path) }),
  );
  // the paste parser, not a second one: a template lands the bytes a paste would, fence-aware and
  // dialect-aware, and refuses what a paste would
  const converted = mdToSlate(editor, body);
  if (!converted.ok) {
    toast.error("That template could not be parsed.");
    return;
  }
  editor.tf.insertFragment(converted.nodes);
};
