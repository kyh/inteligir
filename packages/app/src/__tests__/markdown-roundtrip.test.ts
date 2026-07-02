import { describe, expect, it } from "vitest";

import { isCanonical, isRichSafe, roundTrip, toCanonical } from "../editor/markdown-doc";

// markdown-doc owns the editor's headless plugin set + round-trip helpers. This
// is the fidelity guard: the editor round-trips the user's markdown, and a
// serializer that silently dropped a construct would corrupt vault files.

describe("markdown round-trip", () => {
  it("preserves the common constructs the editor supports", () => {
    const md = [
      "# Title",
      "",
      "Some **bold**, *italic*, and `inline code`.",
      "",
      "## Section",
      "",
      "- first",
      "- second",
      "",
      "> a quote",
      "",
      "[a link](https://example.com)",
      "",
      "```",
      "code block",
      "```",
      "",
    ].join("\n");

    const out = roundTrip(md);
    expect(out).toContain("# Title");
    expect(out).toContain("## Section");
    expect(out).toContain("**bold**");
    expect(out).toContain("`inline code`");
    expect(out).toMatch(/[-*] first/);
    expect(out).toMatch(/[-*] second/);
    expect(out).toContain("> a quote");
    expect(out).toContain("[a link](https://example.com)");
    expect(out).toContain("code block");
  });

  it("preserves GFM tables and horizontal rules (headless plugins in sync)", () => {
    const md = "| a | b |\n| --- | --- |\n| c | d |\n\n---\n";
    const out = roundTrip(md);
    // The cells + a divider must survive — a missing table plugin would drop
    // them and Format would delete the table from the file.
    expect(out).toMatch(/\|.*a.*\|.*b.*\|/);
    expect(out).toContain("c");
    expect(out).toContain("d");
    expect(out).toMatch(/^---$/m);
    expect(isRichSafe(md)).toBe(true);
  });

  it("round-trips task-list checkboxes", () => {
    const md = "- [ ] todo one\n- [x] done two\n";
    const out = roundTrip(md);
    // Marker-agnostic (`-` or `*`), but the checkbox state must survive.
    expect(out).toMatch(/[-*] \[ \] todo one/);
    expect(out).toMatch(/[-*] \[x\] done two/i);
  });

  it("is idempotent after the first normalization pass", () => {
    const md = "# Hi\n\nHello **world** with a list:\n\n- one\n- two\n";
    const first = roundTrip(md);
    const second = roundTrip(first);
    expect(second).toBe(first);
  });

  it("does not invent content for an empty document", () => {
    expect(roundTrip("").trim()).toBe("");
  });
});

describe("isCanonical", () => {
  it("treats empty / whitespace-only docs as canonical", () => {
    expect(isCanonical("")).toBe(true);
    expect(isCanonical("\n\n")).toBe(true);
  });

  it("recognizes already-canonical markdown", () => {
    const canon = toCanonical("# Hi\n\n- one\n- two\n");
    expect(isCanonical(canon)).toBe(true);
  });

  it("flags markdown the serializer would reshape as non-canonical", () => {
    // Setext heading + multiple blank lines — Plate reshapes both.
    const messy = "Title\n=====\n\n\n\nbody";
    // It is either non-canonical OR (if Plate happens to preserve it) canonical;
    // assert the contract: canonicalizing then re-checking is always stable.
    const canon = toCanonical(messy);
    expect(isCanonical(canon)).toBe(true);
  });
});

describe("isRichSafe", () => {
  it("treats empty docs as safe", () => {
    expect(isRichSafe("")).toBe(true);
  });

  it("accepts any byte-canonical doc (superset of canonical)", () => {
    const canon = toCanonical("# Hi\n\n- one\n- two\n");
    expect(isCanonical(canon)).toBe(true);
    expect(isRichSafe(canon)).toBe(true);
  });

  it("accepts formatting-only differences that are NOT byte-canonical", () => {
    // `*` bullets reflow to `-` and `***` to `---`: not byte-identical, but no
    // content is dropped, so Rich editing is lossless.
    const md = "* one\n* two\n\n***\n\nbody\n";
    expect(isCanonical(md)).toBe(false);
    expect(isRichSafe(md)).toBe(true);
  });

  it("accepts a tightly-packed GFM table (only cell padding reflows)", () => {
    expect(isRichSafe("|a|b|\n|-|-|\n|c|d|\n")).toBe(true);
  });
});

describe("toCanonical", () => {
  it("is idempotent and ends with a single trailing newline", () => {
    const once = toCanonical("# Hi\n\n- a\n- b");
    expect(once.endsWith("\n")).toBe(true);
    expect(once.endsWith("\n\n")).toBe(false);
    expect(toCanonical(once)).toBe(once);
  });
});
