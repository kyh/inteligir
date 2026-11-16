import type { BlockContent, Root } from "mdast";
import { describe, expect, it } from "vitest";
import { MarkdownPlugin } from "@platejs/markdown";

import { LIST_MAX_INDENT } from "@repo/contract/library/library-nodes";

import { meaningOf } from "../test-support/markdown-meaning";
import { headlessEditor } from "./markdown-doc";
import { lfOnly, readMarkdown, readMdast } from "./md-read";
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

  // refused by the read's own measure, so the answer is the same on a platform whose stack holds it
  it("refuses 500 quotes deep, short of where any stack runs out", () => {
    expect(read(`${"> ".repeat(500)}x\n`)).toStrictEqual({
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

const paragraph = (value: string): BlockContent => ({
  children: [{ type: "text", value }],
  type: "paragraph",
});

const tree = (...children: BlockContent[]): Root => ({ children, type: "root" });

const quoted = (depth: number): BlockContent => {
  let block = paragraph("x");
  for (let level = 0; level < depth; level += 1) {
    block = { children: [block], type: "blockquote" };
  }
  return block;
};

describe(readMdast, () => {
  it("reads a tree into the editor's blocks by the rules a markdown read ends in", () => {
    expect(
      readMdast(
        headlessEditor(),
        tree(
          { children: [{ type: "text", value: "Title" }], depth: 1, type: "heading" },
          {
            children: [
              { type: "text", value: "Body with " },
              {
                children: [{ type: "text", value: "a link" }],
                type: "link",
                url: "https://a.example/",
              },
              { type: "text", value: "." },
            ],
            type: "paragraph",
          },
        ),
      ),
    ).toStrictEqual({
      ok: true,
      value: [
        { children: [{ text: "Title" }], type: "h1" },
        {
          children: [
            { text: "Body with " },
            { children: [{ text: "a link" }], type: "a", url: "https://a.example/" },
            { text: "." },
          ],
          type: "p",
        },
      ],
    });
  });

  it.each([
    '{{x}} and :date[2026-01-02] and :formula[2]{source="1+1"}',
    ":::tabs",
    "$$x$$ and [[Page]] and [Title](mention:abc)",
    "# not a heading, > not a quote, - not a list, | not | a | table |",
    "[!NOTE]",
    "<div> &copy; \\ `ticks` **stars**",
  ])("reads the text %s as that text, parsed by nothing", (value) => {
    expect(readMdast(headlessEditor(), tree(paragraph(value)))).toStrictEqual({
      ok: true,
      value: [{ children: [{ text: value }], type: "p" }],
    });
  });

  it("reads a text at the root as a paragraph of its own", () => {
    expect(
      readMdast(headlessEditor(), { children: [{ type: "text", value: "Loose." }], type: "root" }),
    ).toStrictEqual({ ok: true, value: [{ children: [{ text: "Loose." }], type: "p" }] });
  });

  it("refuses a tree nested past what an item holds as too deep, wherever a stack would run out", () => {
    expect(readMdast(headlessEditor(), tree(quoted(8))).ok).toBe(true);
    for (const depth of [500, 12_000]) {
      expect(readMdast(headlessEditor(), tree(quoted(depth)))).toStrictEqual({
        ok: false,
        reason: { kind: "too-deep" },
      });
    }
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
    expect(readMdast(editor, tree(paragraph("Body.")))).toStrictEqual({
      ok: false,
      reason: { error: broken, kind: "failed" },
    });
  });
});

describe(lfOnly, () => {
  it("ends every line in LF, a lone CR included", () => {
    expect(lfOnly("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});
