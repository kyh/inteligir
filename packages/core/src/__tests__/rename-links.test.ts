import { describe, expect, it } from "vitest";

import { computeRenameEdits } from "../knowledge/rename-links";

function edits(
  docs: Record<string, string>,
  from: string,
  to: string,
  extraFiles: string[] = [],
): Map<string, string> {
  const map = new Map(Object.entries(docs));
  return computeRenameEdits(map, [...map.keys(), ...extraFiles], from, to);
}

describe("computeRenameEdits — wiki links", () => {
  it("rewrites every form byte-surgically, preserving alias, anchor, and padding", () => {
    const hub = [
      "# Hub",
      "",
      "Plain [[old note]], aliased [[old note|friendly]], anchored [[old note#sec]],",
      "combined [[old note#sec|both]], padded [[ old note ]], embed ![[old note]].",
      "",
    ].join("\n");
    const result = edits({ "hub.md": hub, "old note.md": "# Old\n" }, "old note.md", "new.md");
    expect(result.get("hub.md")).toBe(
      [
        "# Hub",
        "",
        "Plain [[new]], aliased [[new|friendly]], anchored [[new#sec]],",
        "combined [[new#sec|both]], padded [[ new ]], embed ![[new]].",
        "",
      ].join("\n"),
    );
    // The moved doc itself has no links — only hub.md is edited.
    expect([...result.keys()]).toEqual(["hub.md"]);
  });

  it("never rewrites inside fences or code spans", () => {
    const hub = [
      "[[old]]",
      "",
      "```",
      "[[old]] stays",
      "```",
      "",
      "inline `[[old]]` stays",
      "",
    ].join("\n");
    const result = edits({ "hub.md": hub, "old.md": "" }, "old.md", "new.md");
    expect(result.get("hub.md")).toBe(
      ["[[new]]", "", "```", "[[old]] stays", "```", "", "inline `[[old]]` stays", ""].join("\n"),
    );
  });

  it("keeps the short name when unique, falls back to the full path on collision", () => {
    const short = edits(
      { "hub.md": "[[old]]\n", "a/old.md": "" },
      "a/old.md",
      "a/deep/new note.md",
    );
    expect(short.get("hub.md")).toBe("[[new note]]\n");

    const collided = edits(
      { "hub.md": "[[old]]\n", "a/old.md": "", "b/new.md": "" },
      "a/old.md",
      "a/new.md",
    );
    expect(collided.get("hub.md")).toBe("[[a/new]]\n");
  });

  it("preserves an explicitly written extension", () => {
    const result = edits({ "hub.md": "see [[old.md]]\n", "old.md": "" }, "old.md", "new.md");
    expect(result.get("hub.md")).toBe("see [[new.md]]\n");
  });

  it("rewrites links to non-md files with their extension", () => {
    const result = edits({ "hub.md": "embed ![[pic.png]]\n" }, "pic.png", "img/photo.png", [
      "pic.png",
    ]);
    expect(result.get("hub.md")).toBe("embed ![[photo.png]]\n");
  });

  it("rewrites self-links in the moved doc, keyed at the new path", () => {
    const result = edits({ "old.md": "I link [[old]] to myself.\n" }, "old.md", "new.md");
    expect([...result.keys()]).toEqual(["new.md"]);
    expect(result.get("new.md")).toBe("I link [[new]] to myself.\n");
  });

  it("only rewrites links that actually resolve to the renamed file", () => {
    const result = edits(
      { "hub.md": "[[old]] but not [[older]] or [[missing]]\n", "old.md": "", "older.md": "" },
      "old.md",
      "new.md",
    );
    expect(result.get("hub.md")).toBe("[[new]] but not [[older]] or [[missing]]\n");
  });
});

describe("computeRenameEdits — md links", () => {
  it("rewrites relative urls with encoding, keeping fragment and ./ style", () => {
    const hub = "See [a](old%20note.md#sec) and [b](./old%20note.md) and [c](<old note.md>).\n";
    const result = edits({ "hub.md": hub, "old note.md": "" }, "old note.md", "new note.md");
    expect(result.get("hub.md")).toBe(
      "See [a](new%20note.md#sec) and [b](./new%20note.md) and [c](<new%20note.md>).\n",
    );
  });

  it("computes the relative url from each linking doc's directory", () => {
    const result = edits(
      { "deep/dir/hub.md": "[x](../../old.md)\n", "old.md": "" },
      "old.md",
      "moved/new.md",
    );
    expect(result.get("deep/dir/hub.md")).toBe("[x](../../moved/new.md)\n");
  });

  it("rewrites reference definitions", () => {
    const result = edits(
      { "hub.md": "[text][ref]\n\n[ref]: old.md\n", "old.md": "" },
      "old.md",
      "new.md",
    );
    expect(result.get("hub.md")).toBe("[text][ref]\n\n[ref]: new.md\n");
  });

  it("re-bases the moved doc's own outgoing relative links", () => {
    const result = edits(
      { "a/doc.md": "[sibling](sib.md) and [[wiki sib]]\n", "a/sib.md": "", "a/wiki sib.md": "" },
      "a/doc.md",
      "b/c/doc.md",
    );
    // The md link re-bases; the wiki link resolves by name and stays.
    expect(result.get("b/c/doc.md")).toBe("[sibling](../../a/sib.md) and [[wiki sib]]\n");
  });

  it("leaves outgoing links alone when the move stays in the same directory", () => {
    const result = edits(
      { "a/doc.md": "[sibling](sib.md)\n", "a/sib.md": "" },
      "a/doc.md",
      "a/renamed.md",
    );
    expect(result.size).toBe(0);
  });
});

describe("computeRenameEdits — shadow protection", () => {
  it("qualifies another doc's short link when the rename would steal its tie-break", () => {
    // misc.md -> note.md (root): [[note]] would now tie-break to the new root
    // file instead of a/note.md. The rewrite pins the original meaning.
    const result = edits(
      { "hub.md": "see [[note]]\n", "a/note.md": "# The real note\n", "misc.md": "# Misc\n" },
      "misc.md",
      "note.md",
    );
    expect(result.get("hub.md")).toBe("see [[a/note]]\n");
    expect(result.size).toBe(1);
  });

  it("leaves short links alone when the rename does not affect their resolution", () => {
    const result = edits(
      { "hub.md": "see [[note]]\n", "a/note.md": "", "misc.md": "" },
      "misc.md",
      "z/note.md", // deeper than a/note.md — the tie-break still picks a/note.md
    );
    expect(result.size).toBe(0);
  });

  it("re-pins an md url whose case-insensitive fallback the rename steals", () => {
    // [x](Note.md) fell back case-insensitively to note.md; the renamed file
    // lands exactly at Note.md and would capture the link.
    const result = edits(
      { "hub.md": "[x](Note.md)\n", "note.md": "", "misc.md": "" },
      "misc.md",
      "Note.md",
    );
    expect(result.get("hub.md")).toBe("[x](note.md)\n");
  });

  it("dangling links heal silently when the rename lands on their name", () => {
    // [[note]] dangled; renaming misc.md -> note.md makes it resolve. No
    // rewrite — resolution simply starts working.
    const result = edits({ "hub.md": "see [[note]]\n", "misc.md": "" }, "misc.md", "note.md");
    expect(result.size).toBe(0);
  });
});

describe("computeRenameEdits — no-ops", () => {
  it("returns nothing when no links point at the file", () => {
    expect(edits({ "hub.md": "# No links\n", "old.md": "" }, "old.md", "new.md").size).toBe(0);
  });

  it("returns nothing for a same-path rename", () => {
    expect(edits({ "hub.md": "[[old]]\n", "old.md": "" }, "old.md", "old.md").size).toBe(0);
  });
});
