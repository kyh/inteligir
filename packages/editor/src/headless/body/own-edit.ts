import type { SlateEditor } from "platejs";

// Applying the edit of the person at this editor: not a write kept out of its undo, which an undo
// is too, and so is a change that came from elsewhere.
export const appliesOwnEdit = (editor: SlateEditor): boolean => editor.api.isSaving() !== false;
