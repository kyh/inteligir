import { describe, expect, it } from "vitest";
import type { TElement } from "platejs";

import { ALERT_VARIANTS } from "@repo/contract/library/library-nodes";

import {
  meaningOf,
  readValue,
  rewrite,
  writeValue,
} from "../../test-support/markdown-meaning.test-utils";
import { headlessEditor } from "../codec/markdown-doc";
import { readMarkdown } from "./md-read";

const quote = (text: string) =>
  ({
    children: [{ children: [{ text }], type: "p" }],
    type: "blockquote",
  }) satisfies TElement;

describe("an alert", () => {
  it.each(ALERT_VARIANTS)("reads `[!%s]` in either case as the quote's alert", (variant) => {
    const md = `> [!${variant}]\n> Body.\n`;

    for (const written of [md, `> [!${variant.toLowerCase()}]\n> Body.\n`]) {
      expect(readValue(written)).toStrictEqual([{ ...quote("Body."), alert: variant }]);
      expect(rewrite(written)).toBe(md);
    }
  });

  it("reads alike where Obsidian's links are read", () => {
    const md = "> [!NOTE]\n> Body.\n";
    const read = readMarkdown(headlessEditor(), md, { wiki: () => null });
    expect(read).toStrictEqual({ ok: true, value: readValue(md) });
  });

  it("puts the marker on a line of its own, whatever stood beside it", () => {
    expect(rewrite("> [!WARNING] Words on its line.\n")).toBe(
      "> [!WARNING]\n> Words on its line.\n",
    );
    expect(rewrite("> [!CAUTION]\n>\n> One.\n>\n> Two.\n")).toBe(
      "> [!CAUTION]\n> One.\n>\n> Two.\n",
    );
  });

  it("escapes a marker no alert has, so it stays the text it is", () => {
    const value = readValue("> [!NOPE]\n> Body.\n");
    const written = writeValue(value);
    expect(written).toBe("> \\[!NOPE]\\\n> Body.\n");
    expect(meaningOf(readValue(written))).toBe(meaningOf(value));
  });

  it("keeps a marker typed into a quote the words it is", () => {
    const written = writeValue([quote("[!NOTE] typed")]);
    expect(written).toBe("> \\[!NOTE] typed\n");
    expect(readValue(written)).toStrictEqual([quote("[!NOTE] typed")]);
  });

  it("escapes a marker typed outside a quote", () => {
    expect(writeValue([{ children: [{ text: "[!NOTE] typed" }], type: "p" }])).toBe(
      "\\[!NOTE] typed\n",
    );
  });
});
