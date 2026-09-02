// Never set rawDate: its presence flips Plate's default rule to `<date>text</date>` instead of `<date value="…" />`.

import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";
import { BaseDatePlugin } from "@platejs/date";
import { DatePlugin } from "@platejs/date/react";

import { formatIsoDate } from "@repo/notes/iso-date";

import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { DateElement } from "@repo/editor/nodes/date-node";

export const DateBaseKit = [BaseDatePlugin];

function insertDateChip(editor: PlateEditor, iso: string): void {
  insertVoidAndEscape(editor, { children: [{ text: "" }], date: iso, type: KEYS.date });
  editor.tf.insertText(" ");
}

export function insertDate(editor: PlateEditor): void {
  insertDateChip(editor, formatIsoDate(new Date()));
}

// No month-granularity byte form exists, so a month is its first day.
export function insertMonthDate(editor: PlateEditor): void {
  const now = new Date();
  insertDateChip(editor, formatIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
}

export const DateKit = [DatePlugin.withComponent(DateElement)];
