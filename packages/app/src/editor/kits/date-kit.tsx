// Date kit. ISO discipline (locked): the node stores date: "YYYY-MM-DD" and
// NEVER sets rawDate — its presence flips Plate's default rule to the
// `<date>text</date>` children form instead of `<date value="…" />`.

import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";
import { BaseDatePlugin } from "@platejs/date";
import { DatePlugin } from "@platejs/date/react";

import { DateElement } from "@repo/app/editor/nodes/date-node";

export const DateBaseKit = [BaseDatePlugin];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Insert an inline date chip holding today's LOCAL date as ISO bytes, plus a
 * trailing space so the caret escapes the inline void. Slash-menu-ready; the
 * menu entry itself lands in WP3.
 */
export function insertDate(editor: PlateEditor): void {
  const now = new Date();
  const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  editor.tf.insertNodes(
    { children: [{ text: "" }], date: iso, type: KEYS.date },
    { select: true },
  );
  editor.tf.insertText(" ");
}

export const DateKit = [DatePlugin.withComponent(DateElement)];
