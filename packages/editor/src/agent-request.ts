import type { SlateEditor } from "platejs";

import { getEditorHostActions } from "@repo/editor/host-io";

export const askAgentAboutSelection = (editor: SlateEditor): void => {
  const text = editor.selection ? editor.api.string(editor.selection) : "";
  if (text.trim() !== "") {
    getEditorHostActions().agent.askAboutSelection(text);
  }
};
