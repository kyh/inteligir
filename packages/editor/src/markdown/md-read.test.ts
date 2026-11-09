import { describe, expect, it } from "vitest";
import { MarkdownPlugin } from "@platejs/markdown";

import { LIST_MAX_INDENT } from "@repo/contract/library/library-nodes";

import { meaningOf } from "../test-support/markdown-meaning";
import { headlessEditor } from "./markdown-doc";
import { lfOnly, readMarkdown } from "./md-read";
import { MD_RULES } from "./md-rules";

const read = (md: string) => readMarkdown(headlessEditor(), md);

describe(readMarkdown, () => {
  it("reads markdown into the editor's blocks", () => {
    expect(read("# Title\n\nBody.\n")).toStrictEqual({
      ok: true,
      value: [
        { children: [{ text: "Title" }], type: "h1" },
        { children: [{ text: "Body." }], type: "p" },
      ],
    });
  });

  it.each([3000, 6000, 12_000])("refuses %i quotes deep as too deep", (depth) => {
    expect(read(`${"> ".repeat(depth)}x\n`)).toStrictEqual({
      ok: false,
      reason: { kind: "too-deep" },
    });
  });

  it("refuses a list nested past what an item holds as too deep, and reads one at it", () => {
    expect(read(`${"- ".repeat(LIST_MAX_INDENT)}x\n`).ok).toBe(true);
    expect(read(`${"- ".repeat(LIST_MAX_INDENT + 1)}x\n`)).toStrictEqual({
      ok: false,
      reason: { kind: "too-deep" },
    });
  });

  it("refuses a read a rule fails as failed, with the rule's error", () => {
    const editor = headlessEditor();
    const broken = new Error("the rule broke");
    editor.setOption(MarkdownPlugin, "rules", {
      ...MD_RULES,
      p: {
        deserialize: () => {
          throw broken;
        },
      },
    });
    expect(readMarkdown(editor, "Body.\n")).toStrictEqual({
      ok: false,
      reason: { error: broken, kind: "failed" },
    });
  });

  it("reads a file saved with CRLF line endings as the same file with LF", () => {
    const lf = "One\ntwo\n\n- a\n- b\n\n```\ncode\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    const crlf = read(lf.replaceAll("\n", "\r\n"));
    const plain = read(lf);
    if (!crlf.ok || !plain.ok) {
      throw new Error("a read refused");
    }
    expect(meaningOf(crlf.value)).toBe(meaningOf(plain.value));
  });

  it("reads Obsidian's links only when the caller resolves them", () => {
    const md = "See [[Plan]] and [[Gone]].\n";
    expect(read(md)).toMatchObject({
      ok: true,
      value: [{ children: [{ text: "See [[Plan]] and [[Gone]]." }] }],
    });
    const resolved = readMarkdown(headlessEditor(), md, {
      wiki: (link) =>
        link.target === "Plan" ? { itemId: "plan-id", kind: "item", title: "Plan" } : null,
    });
    expect(resolved).toMatchObject({
      ok: true,
      value: [
        {
          children: [
            { text: "See " },
            { key: "plan-id", type: "mention", value: "Plan" },
            { text: " and [[Gone]]." },
          ],
        },
      ],
    });
  });
});

describe(lfOnly, () => {
  it("ends every line in LF, a lone CR included", () => {
    expect(lfOnly("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});
