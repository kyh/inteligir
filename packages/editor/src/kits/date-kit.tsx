import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";
import { DatePlugin } from "@platejs/date/react";

import { formatIsoDate } from "@repo/contract/iso-date";

import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { DateElement } from "@repo/editor/nodes/date-node";

const insertDateChip = (editor: PlateEditor, iso: string) => {
  insertVoidAndEscape(editor, { children: [{ text: "" }], date: iso, type: KEYS.date });
  editor.tf.insertText(" ");
};

export const insertDate = (editor: PlateEditor) => {
  insertDateChip(editor, formatIsoDate(new Date()));
};

export const insertMonthDate = (editor: PlateEditor) => {
  const now = new Date();
  insertDateChip(editor, formatIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
};

export const DateKit = [DatePlugin.withComponent(DateElement)];
