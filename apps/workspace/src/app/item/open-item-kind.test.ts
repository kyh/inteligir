import { describe, expect, it } from "vitest";

import { openItemOf } from "./open-item-kind";

describe("what the open item is", () => {
  it("reads a file that is no doc by its extension, shown as itself", () => {
    expect(openItemOf("assets/Paper.pdf", "")).toMatchObject({
      bareFile: "assets/Paper.pdf",
      facts: null,
      kind: "pdf",
      pending: false,
    });
    expect(openItemOf("Budget.numbers", "").kind).toBe("file");
  });

  it("reads a doc by its frontmatter, a note when it says nothing", () => {
    expect(openItemOf("Tides.md", "# Tides\n")).toMatchObject({
      bareFile: null,
      kind: "note",
      pending: false,
    });
    expect(
      openItemOf("Papers/Paper.md", "---\nkind: pdf\n---\n\n![[assets/Paper.pdf]]\n").kind,
    ).toBe("pdf");
  });

  it("knows a stub whose page has not been read yet, and one whose page has", () => {
    const stub =
      "---\nid: 01J00000000000000000000000\nkind: link\nurl: https://example.com\nsaved: 2026-10-01T09:00:00Z\n---\n";
    expect(openItemOf("Unsorted/example.com.md", stub)).toMatchObject({
      kind: "link",
      pending: true,
    });
    const filled = stub.replace("saved:", "fetched: 2026-10-01T09:00:05Z\nsaved:");
    expect(openItemOf("Unsorted/example.com.md", filled).pending).toBe(false);
  });
});
