import { describe, expect, it } from "vitest";

import { checkNoteName } from "./note-name.test-utils";
import type { NoteNameVerdict } from "./note-name.test-utils";

type Row =
  | { input: string; ok: true; name?: string }
  | { input: string; ok: false; reason: ReturnType<typeof reject> };

const reject = (
  reason: "empty" | "separator" | "illegal-char" | "bracket" | "reserved" | "dot-edge" | "too-long",
) => reason;

const CORPUS: Row[] = [
  { input: "Meeting Notes.md", name: "Meeting Notes.md", ok: true },
  { input: "Meeting Notes", name: "Meeting Notes", ok: true },
  { input: "  padded  ", name: "padded", ok: true },
  { input: "notes & ideas (v2).md", ok: true },
  { input: "a'b,c;d!e@f#g$h%i^j&k", ok: true },
  { input: "note..md", ok: true },
  { input: "2026-07-15.md", ok: true },

  { input: "日本語ノート.md", name: "日本語ノート.md", ok: true },
  { input: "会议记录", ok: true },
  { input: "한국어 노트.md", ok: true },
  { input: "ملاحظات.md", ok: true },
  { input: "🚀 launch plan.md", ok: true },

  { input: "café.md", name: "café.md", ok: true },
  { input: "cafe\u0301.md", name: "café.md", ok: true },

  { input: "", ok: false, reason: reject("empty") },
  { input: "   ", ok: false, reason: reject("empty") },
  { input: "\t\n", ok: false, reason: reject("empty") },

  { input: "a/b.md", ok: false, reason: reject("separator") },
  { input: "a\\b.md", ok: false, reason: reject("separator") },
  { input: "/leading.md", ok: false, reason: reject("separator") },

  { input: "a:b.md", ok: false, reason: reject("illegal-char") },
  { input: "a*b.md", ok: false, reason: reject("illegal-char") },
  { input: "a?b.md", ok: false, reason: reject("illegal-char") },
  { input: 'a"b.md', ok: false, reason: reject("illegal-char") },
  { input: "a<b.md", ok: false, reason: reject("illegal-char") },
  { input: "a>b.md", ok: false, reason: reject("illegal-char") },
  { input: "a|b.md", ok: false, reason: reject("illegal-char") },
  { input: "a\u0000b.md", ok: false, reason: reject("illegal-char") },
  { input: "a\u001Fb.md", ok: false, reason: reject("illegal-char") },
  { input: "a\u007Fb.md", ok: false, reason: reject("illegal-char") },

  { input: "[draft] plan.md", ok: false, reason: reject("bracket") },
  { input: "a]b", ok: false, reason: reject("bracket") },
  { input: "Issue#42.md", ok: true },

  { input: ".hidden", ok: false, reason: reject("dot-edge") },
  { input: ".hidden.md", ok: false, reason: reject("dot-edge") },
  { input: "name.", ok: false, reason: reject("dot-edge") },
  { input: "name.md.", ok: false, reason: reject("dot-edge") },
  { input: "trailing space .md", ok: true },
  { input: "name .", ok: false, reason: reject("dot-edge") },

  { input: "con", ok: false, reason: reject("reserved") },
  { input: "CON.md", ok: false, reason: reject("reserved") },
  { input: "Con.tar.gz", ok: false, reason: reject("reserved") },
  { input: "prn.md", ok: false, reason: reject("reserved") },
  { input: "AUX", ok: false, reason: reject("reserved") },
  { input: "nul.md", ok: false, reason: reject("reserved") },
  { input: "com1.md", ok: false, reason: reject("reserved") },
  { input: "COM9", ok: false, reason: reject("reserved") },
  { input: "lpt1.md", ok: false, reason: reject("reserved") },
  { input: "LPT9.md", ok: false, reason: reject("reserved") },
  { input: "con .md", ok: false, reason: reject("reserved") },
  { input: "com0.md", ok: true },
  { input: "lpt0.md", ok: true },
  { input: "com10.md", ok: true },
  { input: "console.md", ok: true },
  { input: "aux input.md", ok: true },
  { input: "falcon.md", ok: true },

  { input: `${"a".repeat(252)}.md`, ok: true },
  { input: `${"a".repeat(253)}.md`, ok: false, reason: reject("too-long") },
  { input: `${"😀".repeat(63)}.md`, ok: true },
  { input: `${"😀".repeat(64)}.md`, ok: false, reason: reject("too-long") },
  { input: `${"語".repeat(84)}.md`, ok: true },
  { input: `${"語".repeat(85)}.md`, ok: false, reason: reject("too-long") },
];

const titleOf = (row: Row) =>
  `${JSON.stringify(row.input.length > 40 ? `${row.input.slice(0, 40)}…` : row.input)} → ${row.ok ? "ok" : row.reason}`;

const verdictOf = (row: Row) => {
  if (!row.ok) {
    return { ok: false, reason: row.reason } satisfies Partial<NoteNameVerdict>;
  }

  if (row.name === undefined) {
    return { ok: true } satisfies Partial<NoteNameVerdict>;
  }

  return { name: row.name, ok: true } satisfies Partial<NoteNameVerdict>;
};

describe("checkNoteName — golden corpus", () => {
  it.each(CORPUS.map((row) => ({ row, title: titleOf(row) })))("$title", ({ row }) => {
    expect(checkNoteName(row.input)).toMatchObject(verdictOf(row));
  });
});
