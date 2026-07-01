// Date kit — Base half (WP1). ISO discipline (locked): the node stores
// date: "YYYY-MM-DD" and NEVER sets rawDate — its presence flips Plate's
// default rule to the `<date>text</date>` children form instead of
// `<date value="…" />`. WP2 appends DateKit (popover + calendar) and
// insertDate.

import { BaseDatePlugin } from "@platejs/date";

export const DateBaseKit = [BaseDatePlugin];
