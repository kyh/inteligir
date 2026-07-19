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

describe("computeRenameEdits — asset renames", () => {
  it("rewrites md image links byte-surgically, preserving alt, ./ style, and encoding", () => {
    const hub =
      "Shot: ![the alt](old%20pic.png), styled ![x](./old%20pic.png), bare ![](<old pic.png>).\n";
    const result = edits({ "hub.md": hub }, "old pic.png", "img/new pic.png", ["old pic.png"]);
    expect(result.get("hub.md")).toBe(
      "Shot: ![the alt](img/new%20pic.png), styled ![x](./img/new%20pic.png), bare ![](<img/new%20pic.png>).\n",
    );
  });

  it("rewrites every reference form to a renamed asset in one pass", () => {
    const hub = [
      "Embed ![[pic.png]], image ![alt](pic.png), link [download](pic.png).",
      "",
      "![ref image][shot]",
      "",
      "[shot]: pic.png",
      "",
    ].join("\n");
    const result = edits({ "hub.md": hub }, "pic.png", "assets/photo.png", ["pic.png"]);
    expect(result.get("hub.md")).toBe(
      [
        "Embed ![[photo.png]], image ![alt](assets/photo.png), link [download](assets/photo.png).",
        "",
        "![ref image][shot]",
        "",
        "[shot]: assets/photo.png",
        "",
      ].join("\n"),
    );
  });

  it("never rewrites images inside fences", () => {
    const hub = "![x](pic.png)\n\n```\n![x](pic.png) stays\n```\n";
    const result = edits({ "hub.md": hub }, "pic.png", "new.png", ["pic.png"]);
    expect(result.get("hub.md")).toBe("![x](new.png)\n\n```\n![x](pic.png) stays\n```\n");
  });

  it("re-bases the moved doc's own outgoing image urls", () => {
    const result = edits({ "a/doc.md": "![shot](shot.png)\n" }, "a/doc.md", "b/c/doc.md", [
      "a/shot.png",
    ]);
    expect(result.get("b/c/doc.md")).toBe("![shot](../../a/shot.png)\n");
  });

  it("re-pins an image url whose case-insensitive fallback the rename steals", () => {
    // ![x](Pic.png) fell back case-insensitively to pic.png; the renamed file
    // lands exactly at Pic.png and would capture the reference.
    const result = edits({ "hub.md": "![x](Pic.png)\n", "misc.md": "" }, "misc.md", "Pic.png", [
      "pic.png",
    ]);
    expect(result.get("hub.md")).toBe("![x](pic.png)\n");
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

describe("computeRenameEdits — alias shadow protection", () => {
  it("NEVER rewrites a pre-existing alias link to the moved doc (bytes unchanged)", () => {
    // Bar is an alias of the moved doc: `[[Bar]]` resolves via the alias tier
    // before AND after the rename (the alias travels with the frontmatter).
    // The retarget branch keys on the PATH-ONLY pre-resolver, so the author's
    // chosen word must survive byte-exact.
    const result = edits(
      {
        "hub.md": "see [[Bar]] and [[old note]]\n",
        "old note.md": "---\naliases: [Bar]\n---\n# Old\n",
      },
      "old note.md",
      "renamed.md",
    );
    // Only the path-resolved link retargets; [[Bar]] is untouched.
    expect(result.get("hub.md")).toBe("see [[Bar]] and [[renamed]]\n");
  });

  it("qualifies a link whose alias the rename steals, keeping the visible word", () => {
    // `[[Retro]]` reaches notes/owner.md only via its alias; misc.md renamed
    // to Retro.md now captures the name through the basename tier.
    const result = edits(
      {
        "hub.md": "see [[Retro]]\n",
        "notes/owner.md": "---\naliases: [Retro]\n---\n# Owner\n",
        "misc.md": "# Misc\n",
      },
      "misc.md",
      "Retro.md",
    );
    expect(result.get("hub.md")).toBe("see [[notes/owner|Retro]]\n");
    expect(result.size).toBe(1);
  });

  it("qualifies the target only when the link already has a display alias", () => {
    const result = edits(
      {
        "hub.md": "see [[Retro|the retro]]\n",
        "notes/owner.md": "---\naliases: [Retro]\n---\n",
        "misc.md": "",
      },
      "misc.md",
      "Retro.md",
    );
    expect(result.get("hub.md")).toBe("see [[notes/owner|the retro]]\n");
  });

  it("qualifies the target only when the link carries an anchor", () => {
    // Appending `|raw` before `#sec` would swallow the anchor into the
    // display text (the body splits at the FIRST pipe).
    const result = edits(
      {
        "hub.md": "see [[Retro#sec]]\n",
        "notes/owner.md": "---\naliases: [Retro]\n---\n# O\n\n## sec\n",
        "misc.md": "",
      },
      "misc.md",
      "Retro.md",
    );
    expect(result.get("hub.md")).toBe("see [[notes/owner#sec]]\n");
  });

  it("does nothing when the moved doc is renamed TO its own alias", () => {
    // [[Retro]] resolved to owner via its alias; post-rename it resolves to
    // the same doc via the basename tier — meaning unchanged, bytes unchanged.
    const result = edits(
      {
        "hub.md": "see [[Retro]]\n",
        "owner.md": "---\naliases: [Retro]\n---\n# Owner\n",
      },
      "owner.md",
      "Retro.md",
    );
    expect(result.size).toBe(0);
  });

  it("alias-ci links are protected too", () => {
    // `[[retro]]` (lowercase) reaches the owner via the alias-ci tier; the
    // rename to retro.md captures it via the basename tier.
    const result = edits(
      {
        "hub.md": "see [[retro]]\n",
        "notes/owner.md": "---\naliases: [Retro]\n---\n",
        "misc.md": "",
      },
      "misc.md",
      "retro.md",
    );
    expect(result.get("hub.md")).toBe("see [[notes/owner|retro]]\n");
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
