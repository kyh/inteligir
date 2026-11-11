import { describe, expect, it } from "vitest";

import { meaningOf, readValue, rewrite, writeValue } from "../test-support/markdown-meaning";
import { ALERT_VARIANTS } from "./alert-marker";
import { headlessEditor } from "./markdown-doc";
import { readMarkdown } from "./md-read";

const KINDS = ALERT_VARIANTS.flatMap((variant) => [variant, variant.toLowerCase()]);

// GitHub's alert is the one callout: a quote whose text opens with its marker
describe("an alert", () => {
  it.each(KINDS)("reads `[!%s]` as a quote led by its marker, and writes it back", (kind) => {
    const md = `> [!${kind}]\n> Body.\n`;
    expect(readValue(md)).toStrictEqual([
      {
        children: [{ children: [{ text: `[!${kind}]\nBody.` }], type: "p" }],
        type: "blockquote",
      },
    ]);
    expect(rewrite(md)).toBe(md);
  });

  it.each(KINDS)("reads `[!%s]` alike where Obsidian's links are read", (kind) => {
    const md = `> [!${kind}]\n> Body.\n`;
    const read = readMarkdown(headlessEditor(), md, { wiki: () => null });
    expect(read).toStrictEqual({ ok: true, value: readValue(md) });
  });

  it("keeps the words on the marker's line and every paragraph after it", () => {
    for (const md of ["> [!WARNING] Words on its line.\n", "> [!CAUTION]\n> One.\n>\n> Two.\n"]) {
      expect(rewrite(md)).toBe(md);
    }
  });

  it("escapes a marker no alert has, so it stays the text it is", () => {
    const value = readValue("> [!NOPE]\n> Body.\n");
    const written = writeValue(value);
    expect(written).toBe("> \\[!NOPE]\\\n> Body.\n");
    expect(meaningOf(readValue(written))).toBe(meaningOf(value));
  });

  it("escapes a marker typed outside a quote", () => {
    expect(writeValue([{ children: [{ text: "[!NOTE] typed" }], type: "p" }])).toBe(
      "\\[!NOTE] typed\n",
    );
  });
});
