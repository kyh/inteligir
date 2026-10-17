import { describe, expect, it } from "vitest";

import { analyzeMarkdown, canonicalizeImported } from "@repo/editor/markdown/markdown-doc";

const settled = (md: string) => {
  const imported = canonicalizeImported(md);
  if (imported === null) {
    throw new Error(`expected ${JSON.stringify(md)} to settle`);
  }
  return imported;
};

describe("canonicalizeImported", () => {
  it("answers a canonical page as it is, every letter kept", () => {
    const md = "# Title\n\nA paragraph with **bold** text.\n\n- one\n- two\n";
    expect(settled(md)).toEqual({ kept: 1, markdown: md });
  });

  it("writes a page in the editor's own spelling, a fixpoint the gate calls canonical", () => {
    const imported = settled("Title\n=====\n\n* one\n* two\n\n\n");
    expect(imported.markdown).toBe("# Title\n\n- one\n- two\n");
    expect(imported.kept).toBe(1);
    expect(analyzeMarkdown(imported.markdown)).toEqual({ kind: "canonical" });
    expect(settled(imported.markdown).markdown).toBe(imported.markdown);
  });

  it("counts the letters a spelling drops, so a plainer rung can win", () => {
    const imported = settled("a&nbsp;b and a &mdash; b\n");
    expect(imported.markdown).toBe("a\u00a0b and a — b\n");
    // "anbspbandamdashb" is 16 letters, of which "abandab" survive
    expect(imported.kept).toBe(7 / 16);
  });

  it("answers an empty page as empty", () => {
    expect(canonicalizeImported("  \n\n")).toEqual({ kept: 1, markdown: "" });
  });

  it("answers null where the editor cannot hold the page", () => {
    expect(canonicalizeImported(`${"> ".repeat(3000)}x\n`)).toBeNull();
  });
});
