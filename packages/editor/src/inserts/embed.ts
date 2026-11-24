import type { TElement } from "platejs";
import type { PlateEditor } from "platejs/react";

import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { embedTypeForUrl } from "@repo/editor/headless/lib/embed-url";

export const embedNodeForUrl = (url: string) => {
  const type = embedTypeForUrl(url);

  return (type === null ? null : { children: [{ text: "" }], type, url }) satisfies TElement | null;
};

export const insertEmbedFromUrl = (editor: PlateEditor, url: string) => {
  const embed = embedNodeForUrl(url.trim());

  if (embed === null) {
    return false;
  }

  insertVoidAndEscape(editor, embed);

  return true;
};
