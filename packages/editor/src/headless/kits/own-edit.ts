import type { SlateEditor } from "platejs";

export const appliesOwnEdit = (editor: SlateEditor) => editor.api.isSaving() !== false;
