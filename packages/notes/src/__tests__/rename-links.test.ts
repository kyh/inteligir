import { describe, expect, it } from "vitest";

import { scanDoc } from "../knowledge/link-extract";
import { computeMoveEdits } from "../knowledge/rename-links";

const moveEdits = (
  docs: Record<string, string>,
  moves: Record<string, string>,
  extraFiles: string[] = [],
): Map<string, string> => {
  const map = new Map(Object.entries(docs));
  const scans = [...map].map(([path, content]) => ({ path, scan: scanDoc(content) }));
  return computeMoveEdits({
    aliasEntries: scans.flatMap(({ path, scan }) =>
      scan.aliases.map((alias): readonly [string, string] => [alias, path]),
    ),
    allFiles: [...map.keys(), ...extraFiles],
    docs: map,
    idEntries: scans.flatMap(({ path, scan }): (readonly [string, string])[] =>
      scan.noteId === null ? [] : [[scan.noteId, path]],
    ),
    moves: new Map(Object.entries(moves)),
  });
};

// a note's rename is the one-move case
const edits = (
  docs: Record<string, string>,
  from: string,
  to: string,
  extraFiles: string[] = [],
): Map<string, string> => moveEdits(docs, { [from]: to }, extraFiles);

describe("computeMoveEdits — wiki links", () => {
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
    expect([...result.keys()]).toEqual(["hub.md"]);
  });

  it("never rewrites inside a range the editor holds verbatim", () => {
    const hub = [
      "[[old]]",
      "",
      "<div>[[old]]</div>",
      "",
      "math $$[[old]]$$ math",
      "",
      "{ expr [[old]] expr }",
      "",
    ].join("\n");
    const result = edits({ "hub.md": hub, "old.md": "" }, "old.md", "new.md");
    expect(result.get("hub.md")).toBe(
      [
        "[[new]]",
        "",
        "<div>[[old]]</div>",
        "",
        "math $$[[old]]$$ math",
        "",
        "{ expr [[old]] expr }",
        "",
      ].join("\n"),
    );
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
      { "a/old.md": "", "hub.md": "[[old]]\n" },
      "a/old.md",
      "a/deep/new note.md",
    );
    expect(short.get("hub.md")).toBe("[[new note]]\n");

    const collided = edits(
      { "a/old.md": "", "b/new.md": "", "hub.md": "[[old]]\n" },
      "a/old.md",
      "a/new.md",
    );
    expect(collided.get("hub.md")).toBe("[[a/new]]\n");
  });

  it("writes the extension when an extensionless file holds the path a link would spell", () => {
    const result = edits(
      { "a/note.md": "", "b/other.md": "", "c/note.md": "", "x.md": "[[a/note]]\n" },
      "a/note.md",
      "b/note.md",
      ["b/note"],
    );
    expect(result.get("x.md")).toBe("[[b/note.md]]\n");

    const root = edits({ "hub.md": "[[old]]\n", "old.md": "" }, "old.md", "new.md", ["new"]);
    expect(root.get("hub.md")).toBe("[[new.md]]\n");
  });

  it("keeps a root note's bare path, which no folder's note of that name can take", () => {
    const result = edits(
      { "hub.md": "[[old]]\n", "old.md": "", "sub/new.md": "" },
      "old.md",
      "new.md",
    );
    expect(result.get("hub.md")).toBe("[[new]]\n");
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

  it("escapes a `#` the new name would split on, in the company of the link's anchor", () => {
    const hub = "[[old]], [[old#sec]], [[old|shown]], [[C# old]]\n";
    const result = edits({ "C# old.md": "", "hub.md": hub, "old.md": "" }, "old.md", "Issue#42.md");
    expect(result.get("hub.md")).toBe(
      "[[Issue\\#42]], [[Issue\\#42#sec]], [[Issue\\#42|shown]], [[C# old]]\n",
    );
    const plain = edits({ "hub.md": "[[old#sec]]\n", "old.md": "" }, "old.md", "C# Notes.md");
    expect(plain.get("hub.md")).toBe("[[C# Notes#sec]]\n");
  });

  it("rewrites an escaped link like any other, keeping its anchor", () => {
    const result = edits(
      { "Issue#42.md": "", "hub.md": "[[Issue\\#42]] and [[Issue\\#42#sec]]\n" },
      "Issue#42.md",
      "Issue 42.md",
    );
    expect(result.get("hub.md")).toBe("[[Issue 42]] and [[Issue 42#sec]]\n");
  });

  it("writes a `.txt` note's name with its extension", () => {
    const result = edits({ "hub.md": "[[old]]\n", "old.md": "" }, "old.md", "notes/todo.txt");
    expect(result.get("hub.md")).toBe("[[todo.txt]]\n");
  });

  it("leaves a link no body can carry as written", () => {
    const result = edits({ "hub.md": "[[old]]\n", "old.md": "" }, "old.md", "[draft].md");
    expect(result.size).toBe(0);
  });
});

describe("computeMoveEdits — md links", () => {
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

describe("computeMoveEdits — asset renames", () => {
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
    const result = edits({ "hub.md": "![x](Pic.png)\n", "misc.md": "" }, "misc.md", "Pic.png", [
      "pic.png",
    ]);
    expect(result.get("hub.md")).toBe("![x](pic.png)\n");
  });
});

describe("computeMoveEdits — shadow protection", () => {
  it("qualifies another doc's short link when the rename would steal its tie-break", () => {
    const result = edits(
      { "a/note.md": "# The real note\n", "hub.md": "see [[note]]\n", "misc.md": "# Misc\n" },
      "misc.md",
      "note.md",
    );
    expect(result.get("hub.md")).toBe("see [[a/note]]\n");
    expect(result.size).toBe(1);
  });

  it("leaves short links alone when the rename does not affect their resolution", () => {
    const result = edits(
      { "a/note.md": "", "hub.md": "see [[note]]\n", "misc.md": "" },
      "misc.md",
      // a/note.md still wins the tie-break
      "z/note.md",
    );
    expect(result.size).toBe(0);
  });

  it("re-pins an md url whose case-insensitive fallback the rename steals", () => {
    const result = edits(
      { "hub.md": "[x](Note.md)\n", "misc.md": "", "note.md": "" },
      "misc.md",
      "Note.md",
    );
    expect(result.get("hub.md")).toBe("[x](note.md)\n");
  });

  it("dangling links heal silently when the rename lands on their name", () => {
    const result = edits({ "hub.md": "see [[note]]\n", "misc.md": "" }, "misc.md", "note.md");
    expect(result.size).toBe(0);
  });
});

describe("computeMoveEdits — alias shadow protection", () => {
  it("NEVER rewrites a pre-existing alias link to the moved doc (bytes unchanged)", () => {
    const result = edits(
      {
        "hub.md": "see [[Bar]] and [[old note]]\n",
        "old note.md": "---\naliases: [Bar]\n---\n# Old\n",
      },
      "old note.md",
      "renamed.md",
    );
    expect(result.get("hub.md")).toBe("see [[Bar]] and [[renamed]]\n");
  });

  it("qualifies a link whose alias the rename steals, keeping the visible word", () => {
    const result = edits(
      {
        "hub.md": "see [[Retro]]\n",
        "misc.md": "# Misc\n",
        "notes/owner.md": "---\naliases: [Retro]\n---\n# Owner\n",
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
        "misc.md": "",
        "notes/owner.md": "---\naliases: [Retro]\n---\n",
      },
      "misc.md",
      "Retro.md",
    );
    expect(result.get("hub.md")).toBe("see [[notes/owner|the retro]]\n");
  });

  it("qualifies the target only when the link carries an anchor", () => {
    const result = edits(
      {
        "hub.md": "see [[Retro#sec]]\n",
        "misc.md": "",
        "notes/owner.md": "---\naliases: [Retro]\n---\n# O\n\n## sec\n",
      },
      "misc.md",
      "Retro.md",
    );
    expect(result.get("hub.md")).toBe("see [[notes/owner#sec]]\n");
  });

  it("does nothing when the moved doc is renamed TO its own alias", () => {
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

  it("reads the alias owner from the vault's aliases, not from the docs it rewrites", () => {
    const result = computeMoveEdits({
      aliasEntries: [["Retro", "notes/owner.md"]],
      allFiles: ["hub.md", "misc.md", "notes/owner.md"],
      docs: new Map([
        ["hub.md", "see [[Retro]]\n"],
        ["misc.md", "# Misc\n"],
      ]),
      idEntries: [],
      moves: new Map([["misc.md", "Retro.md"]]),
    });
    expect(result.get("hub.md")).toBe("see [[notes/owner|Retro]]\n");
    expect(result.size).toBe(1);
  });

  it("alias-ci links are protected too", () => {
    const result = edits(
      {
        "hub.md": "see [[retro]]\n",
        "misc.md": "",
        "notes/owner.md": "---\naliases: [Retro]\n---\n",
      },
      "misc.md",
      "retro.md",
    );
    expect(result.get("hub.md")).toBe("see [[notes/owner|retro]]\n");
  });
});

describe("computeMoveEdits — the [[Title|uuid]] tier", () => {
  const UUID = "9e64c3df-c1e2-4a4d-8c07-91528f422413";
  const OTHER_UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it("retitles a uuid link by its id, though its title no longer names the note", () => {
    const result = edits(
      {
        "hub.md": `see [[Old Title|${UUID}]] and [[Old Title#sec|${UUID}]]\n`,
        "target.md": `---\nid: ${UUID}\n---\n# Target\n`,
      },
      "target.md",
      "archive/New Name.md",
    );
    expect(result.get("hub.md")).toBe(`see [[New Name|${UUID}]] and [[New Name#sec|${UUID}]]\n`);
  });

  it("leaves a uuid link naming another note alone, though its title spells the renamed one", () => {
    const result = edits(
      {
        "hub.md": `[[target]] and [[target|${OTHER_UUID}]]\n`,
        "other.md": `---\nid: ${OTHER_UUID}\n---\n# Other\n`,
        "target.md": "# Target\n",
      },
      "target.md",
      "New.md",
    );
    expect(result.get("hub.md")).toBe(`[[New]] and [[target|${OTHER_UUID}]]\n`);
  });

  it("falls back to the title when no note carries the uuid", () => {
    const result = edits(
      { "hub.md": `[[target|${UUID}]]\n`, "target.md": "" },
      "target.md",
      "New.md",
    );
    expect(result.get("hub.md")).toBe(`[[New|${UUID}]]\n`);
  });

  it("qualifies a uuid link's title when the rename steals the name it spells", () => {
    const result = edits(
      {
        "a/note.md": `---\nid: ${UUID}\n---\n# The real note\n`,
        "hub.md": `see [[note|${UUID}]]\n`,
        "misc.md": "# Misc\n",
      },
      "misc.md",
      "note.md",
    );
    expect(result.get("hub.md")).toBe(`see [[a/note|${UUID}]]\n`);
  });

  it("never qualifies a uuid link whose title already spelled another note", () => {
    const result = edits(
      {
        "a/note.md": "# A note\n",
        "hub.md": `see [[note|${UUID}]]\n`,
        "misc.md": "# Misc\n",
        "owner.md": `---\nid: ${UUID}\n---\n# Owner\n`,
      },
      "misc.md",
      "note.md",
    );
    expect(result.size).toBe(0);
  });
});

const bomFirstLine = (name: string, eol: string): string =>
  [
    `\uFEFF[[${name}]] opens the note, [[${name}|friendly]] and ![[${name}]] follow`,
    `md [x](${name}.md) and ![](${name}.md), while <div>[[old]]</div> and \`[[old]]\` stay`,
    "",
    `[ref]: ${name}.md`,
    "",
  ].join(eol);

const bomUnderFrontmatter = (name: string, eol: string): string =>
  ["\uFEFF---", "title: Hub", "---", `See [[${name}]] and [x](${name}.md).`, ""].join(eol);

describe("computeMoveEdits — a note that starts with a BOM", () => {
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("%s: changes exactly the target bytes", (_, eol) => {
    const result = edits(
      { "a.md": bomFirstLine("old", eol), "b.md": bomUnderFrontmatter("old", eol), "old.md": "" },
      "old.md",
      "new.md",
    );
    expect(result.get("a.md")).toBe(bomFirstLine("new", eol));
    expect(result.get("b.md")).toBe(bomUnderFrontmatter("new", eol));
  });
});

describe("computeMoveEdits — a folder move", () => {
  it("rewrites links into the folder and out of it, and leaves links inside it alone", () => {
    const result = moveEdits(
      {
        "hub.md": "Read [n](proj/note.md), [[proj/note]] and ![[proj/pic.png]].\n",
        "proj/note.md":
          "Up [h](../hub.md), across [s](sibling.md), [[proj/sibling]], [[sibling]].\n",
        "proj/sibling.md": "",
      },
      {
        "proj/note.md": "archive/project/note.md",
        "proj/pic.png": "archive/project/pic.png",
        "proj/sibling.md": "archive/project/sibling.md",
      },
      ["proj/pic.png"],
    );
    expect(result.get("hub.md")).toBe(
      "Read [n](archive/project/note.md), [[note]] and ![[pic.png]].\n",
    );
    expect(result.get("archive/project/note.md")).toBe(
      "Up [h](../../hub.md), across [s](sibling.md), [[sibling]], [[sibling]].\n",
    );
    expect([...result.keys()].toSorted()).toEqual(["archive/project/note.md", "hub.md"]);
  });

  it("qualifies a short name the move made ambiguous, whichever moved file it names", () => {
    const result = moveEdits(
      {
        "hub.md": "[[proj/a/index]] and [[proj/b/index]]\n",
        "proj/a/index.md": "",
        "proj/b/index.md": "",
      },
      { "proj/a/index.md": "work/a/index.md", "proj/b/index.md": "work/b/index.md" },
    );
    expect(result.get("hub.md")).toBe("[[work/a/index]] and [[work/b/index]]\n");
  });

  it("qualifies a link whose tie-break a moved file takes over", () => {
    const result = moveEdits(
      { "deep/proj/note.md": "", "hub.md": "see [[note]]\n", "x/note.md": "" },
      { "deep/proj/note.md": "a/note.md" },
    );
    expect(result.get("hub.md")).toBe("see [[x/note]]\n");
  });

  it("qualifies a link its moved target no longer wins the tie-break for", () => {
    const result = moveEdits(
      { "hub.md": "see [[note]]\n", "other/note.md": "", "proj/note.md": "" },
      { "proj/note.md": "archive/proj/note.md" },
    );
    expect(result.get("hub.md")).toBe("see [[archive/proj/note]]\n");
  });
});

describe("computeMoveEdits — no-ops", () => {
  it("returns nothing when no links point at the file", () => {
    expect(edits({ "hub.md": "# No links\n", "old.md": "" }, "old.md", "new.md").size).toBe(0);
  });

  it("returns nothing for a same-path rename", () => {
    expect(edits({ "hub.md": "[[old]]\n", "old.md": "" }, "old.md", "old.md").size).toBe(0);
  });
});
