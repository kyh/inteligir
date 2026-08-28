// Date kit. ISO discipline (locked): the node stores date: "YYYY-MM-DD" and
// NEVER sets rawDate — its presence flips Plate's default rule to the
// `<date>text</date>` children form instead of `<date value="…" />`.

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

/**
 * Insert an inline date chip holding today's LOCAL date as ISO bytes, plus a
 * trailing space so the caret escapes the inline void. Inserted from the
 * slash menu's Date and Day entries.
 */
export function insertDate(editor: PlateEditor): void {
  insertDateChip(editor, formatIsoDate(new Date()));
}

/**
 * The slash menu's Month entry: the SAME chip, holding the current month as
 * its first day. The node's ISO discipline admits no month-granularity byte
 * form, so the month is represented by its canonical first day rather than a
 * second spelling the round-trip would have to learn.
 */
export function insertMonthDate(editor: PlateEditor): void {
  const now = new Date();
  insertDateChip(editor, formatIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
}

export const DateKit = [DatePlugin.withComponent(DateElement)];
