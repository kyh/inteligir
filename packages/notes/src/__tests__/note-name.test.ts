// A verdict change here changes which names the product accepts: a breaking change, not a refactor casualty.

import { describe, expect, it } from "vitest";

import { checkNoteName, noteNameErrorMessage } from "../knowledge/note-name";

type Row =
  | { input: string; ok: true; name?: string }
  | { input: string; ok: false; reason: ReturnType<typeof reject> };

function reject(
  reason: "empty" | "separator" | "illegal-char" | "reserved" | "dot-edge" | "too-long",
) {
  return reason;
}

const CORPUS: Row[] = [
  { input: "Meeting Notes.md", ok: true, name: "Meeting Notes.md" },
  { input: "Meeting Notes", ok: true, name: "Meeting Notes" },
  { input: "  padded  ", ok: true, name: "padded" },
  { input: "notes & ideas (v2).md", ok: true },
  { input: "a'b,c;d!e@f#g$h%i^j&k", ok: true },
  { input: "note..md", ok: true },
  { input: "2026-07-15.md", ok: true },

  { input: "日本語ノート.md", ok: true, name: "日本語ノート.md" },
  { input: "会议记录", ok: true },
  { input: "한국어 노트.md", ok: true },
  { input: "ملاحظات.md", ok: true },
  { input: "🚀 launch plan.md", ok: true },

  { input: "café.md", ok: true, name: "café.md" }, // composed stays
  { input: "cafe\u0301.md", ok: true, name: "café.md" }, // decomposed → NFC

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
  { input: "a\u001fb.md", ok: false, reason: reject("illegal-char") },
  { input: "a\u007fb.md", ok: false, reason: reject("illegal-char") },

  { input: ".hidden", ok: false, reason: reject("dot-edge") },
  { input: ".hidden.md", ok: false, reason: reject("dot-edge") },
  { input: "name.", ok: false, reason: reject("dot-edge") },
  { input: "name.md.", ok: false, reason: reject("dot-edge") },
  { input: "trailing space .md", ok: true },
  { input: "name .", ok: false, reason: reject("dot-edge") }, // trims to "name ." → trailing dot

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
  { input: "con .md", ok: false, reason: reject("reserved") }, // Windows ignores the trailing space
  // not reserved: 0-index, longer words, reserved-as-suffix
  { input: "com0.md", ok: true },
  { input: "lpt0.md", ok: true },
  { input: "com10.md", ok: true },
  { input: "console.md", ok: true },
  { input: "aux input.md", ok: true },
  { input: "falcon.md", ok: true },

  { input: `${"a".repeat(252)}.md`, ok: true }, // exactly 255 bytes
  { input: `${"a".repeat(253)}.md`, ok: false, reason: reject("too-long") }, // 256
  // astral chars are 4 bytes: 63×4 + 3 = 255
  { input: `${"😀".repeat(63)}.md`, ok: true },
  { input: `${"😀".repeat(64)}.md`, ok: false, reason: reject("too-long") },
  // CJK is 3 bytes: 84×3 + 3 = 255
  { input: `${"語".repeat(84)}.md`, ok: true },
  { input: `${"語".repeat(85)}.md`, ok: false, reason: reject("too-long") },
];

describe("checkNoteName — golden corpus", () => {
  for (const row of CORPUS) {
    it(`${JSON.stringify(row.input.length > 40 ? `${row.input.slice(0, 40)}…` : row.input)} → ${row.ok ? "ok" : row.reason}`, () => {
      const verdict = checkNoteName(row.input);
      if (row.ok) {
        expect(verdict.ok).toBe(true);
        if (verdict.ok && row.name !== undefined) expect(verdict.name).toBe(row.name);
      } else {
        expect(verdict).toEqual({ ok: false, reason: row.reason });
      }
    });
  }

  it("every reason maps to user-facing copy", () => {
    for (const reason of [
      "empty",
      "separator",
      "illegal-char",
      "reserved",
      "dot-edge",
      "too-long",
    ] as const) {
      expect(noteNameErrorMessage(reason)).toMatch(/\S/);
    }
  });
});
