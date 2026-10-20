import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { VaultService } from "../vault/vault-service";
import { renameNoteWithLinkRewrite } from "./rename";
import { bootIndexedVault, makeVaultDirs } from "./test-support/indexed-vault";

const boot = () => bootIndexedVault(makeVaultDirs("inteligir-knowledge-rename-"));

describe("rename with link rewrite", () => {
  it("rewrites exactly the candidate docs and records the old stem as an alias", async () => {
    const { root, service, knowledge } = boot();
    await service.write("notes/target.md", "# Target\n\nContent here.\n");
    await service.write("a.md", "Links to [[target]] today.\n");
    await service.write("b.md", "See [details](notes/target.md) for more.\n");
    await service.write("unrelated.md", "No links, though target is a word here.\n");

    const candidates = await knowledge.renameCandidates(
      new Map([["notes/target.md", "archive/moved.md"]]),
    );
    expect(candidates.toSorted()).toEqual(["a.md", "b.md", "notes/target.md"]);

    const result = await renameNoteWithLinkRewrite({
      from: "notes/target.md",
      knowledge,
      service,
      to: "archive/moved.md",
    });
    expect(result.path).toBe("archive/moved.md");
    expect(result.rewritten.toSorted()).toEqual(["a.md", "b.md"]);
    expect(result.skipped).toEqual([]);

    expect(readFileSync(path.join(root, "a.md"), "utf-8")).toBe("Links to [[moved]] today.\n");
    expect(readFileSync(path.join(root, "b.md"), "utf-8")).toBe(
      "See [details](archive/moved.md) for more.\n",
    );
    expect(readFileSync(path.join(root, "unrelated.md"), "utf-8")).toBe(
      "No links, though target is a word here.\n",
    );
    const moved = readFileSync(path.join(root, "archive", "moved.md"), "utf-8");
    expect(moved).toContain("aliases:");
    expect(moved).toContain("target");
    expect(moved.endsWith("# Target\n\nContent here.\n")).toBe(true);

    const backlinks = await knowledge.backlinks("archive/moved.md");
    expect(backlinks.map((entry) => entry.sourcePath).toSorted()).toEqual(["a.md", "b.md"]);
  });

  it("with alias false rewrites the links and keeps the old stem as no alias", async () => {
    const { root, service, knowledge } = boot();
    const stub = "---\nkind: link\nurl: https://stephango.com/file-over-app\n---\n";
    await service.write("Unsorted/stephango.com - file over app.md", stub);
    await service.write("a.md", "Read [[stephango.com - file over app]] later.\n");

    const result = await renameNoteWithLinkRewrite({
      alias: false,
      from: "Unsorted/stephango.com - file over app.md",
      knowledge,
      service,
      to: "Unsorted/File over app.md",
    });
    expect(result).toEqual({ path: "Unsorted/File over app.md", rewritten: ["a.md"], skipped: [] });
    expect(readFileSync(path.join(root, "a.md"), "utf-8")).toBe("Read [[File over app]] later.\n");
    expect(readFileSync(path.join(root, "Unsorted", "File over app.md"), "utf-8")).toBe(stub);
  });

  it("qualifies links a shadowing rename would steal", async () => {
    const { root, service, knowledge } = boot();
    await service.write("a/note.md", "# A note\n");
    await service.write("s.md", "Ref [[note]] here.\n");
    await service.write("other.md", "# Other\n");
    await knowledge.settle();

    const candidates = await knowledge.renameCandidates(new Map([["other.md", "note.md"]]));
    expect(candidates.toSorted()).toEqual(["other.md", "s.md"]);

    await renameNoteWithLinkRewrite({
      from: "other.md",
      knowledge,
      service,
      to: "note.md",
    });

    // the new root note.md would shadow a/note.md, so the link is qualified.
    expect(readFileSync(path.join(root, "s.md"), "utf-8")).toBe("Ref [[a/note]] here.\n");
    const backlinks = await knowledge.backlinks("a/note.md");
    expect(backlinks.map((entry) => entry.sourcePath)).toEqual(["s.md"]);
  });

  it("qualifies a link whose alias the rename steals, though the alias owner is no candidate", async () => {
    const { root, service, knowledge } = boot();
    await service.write("notes/owner.md", "---\naliases: [Retro]\n---\n# Owner\n");
    await service.write("hub.md", "see [[Retro]]\n");
    await service.write("misc.md", "# Misc\n");
    await knowledge.settle();

    const candidates = await knowledge.renameCandidates(new Map([["misc.md", "Retro.md"]]));
    expect(candidates.toSorted()).toEqual(["hub.md", "misc.md"]);

    const result = await renameNoteWithLinkRewrite({
      from: "misc.md",
      knowledge,
      service,
      to: "Retro.md",
    });
    expect(result.rewritten).toEqual(["hub.md"]);
    expect(readFileSync(path.join(root, "hub.md"), "utf-8")).toBe("see [[notes/owner|Retro]]\n");
    const backlinks = await knowledge.backlinks("notes/owner.md");
    expect(backlinks.map((entry) => entry.sourcePath)).toEqual(["hub.md"]);
  });

  it("retitles a [[Title|uuid]] link by the id the index holds, though its title is stale", async () => {
    const { root, service, knowledge } = boot();
    const uuid = "9e64c3df-c1e2-4a4d-8c07-91528f422413";
    await service.write("target.md", `---\nid: ${uuid}\n---\n# Target\n`);
    await service.write("hub.md", `see [[Old Title|${uuid}]]\n`);
    await knowledge.settle();

    const result = await renameNoteWithLinkRewrite({
      from: "target.md",
      knowledge,
      service,
      to: "New Name.md",
    });
    expect(result.rewritten).toContain("hub.md");
    expect(readFileSync(path.join(root, "hub.md"), "utf-8")).toBe(`see [[New Name|${uuid}]]\n`);
  });

  it("rewrites the links a folder move would break, and records no alias", async () => {
    const { root, service, knowledge } = boot();
    await service.write(
      "hub.md",
      "Read [the note](proj/note.md), [[proj/note]], ![[proj/sibling]].\n",
    );
    await service.write(
      "proj/note.md",
      "# Note\n\nUp to [hub](../hub.md), across [sib](sibling.md) and [[proj/sibling]].\n",
    );
    await service.write("proj/sibling.md", "# Sibling\n\nBack to [[note]].\n");
    // every link the three notes write resolves: hub's three, the note's three, the sibling's one
    const resolvedLinks = async (docs: readonly string[]): Promise<number> => {
      const inbound = await Promise.all(docs.map(async (doc) => await knowledge.backlinks(doc)));
      return inbound.flat().length;
    };
    expect(await resolvedLinks(["hub.md", "proj/note.md", "proj/sibling.md"])).toBe(7);

    const result = await renameNoteWithLinkRewrite({
      from: "proj",
      knowledge,
      service,
      to: "archive/project",
    });
    expect(result.path).toBe("archive/project");
    expect(result.rewritten.toSorted()).toEqual(["archive/project/note.md", "hub.md"]);
    expect(result.skipped).toEqual([]);

    expect(readFileSync(path.join(root, "hub.md"), "utf-8")).toBe(
      "Read [the note](archive/project/note.md), [[note]], ![[sibling]].\n",
    );
    expect(readFileSync(path.join(root, "archive", "project", "note.md"), "utf-8")).toBe(
      "# Note\n\nUp to [hub](../../hub.md), across [sib](sibling.md) and [[sibling]].\n",
    );
    expect(readFileSync(path.join(root, "archive", "project", "sibling.md"), "utf-8")).toBe(
      "# Sibling\n\nBack to [[note]].\n",
    );
    expect(
      await resolvedLinks(["hub.md", "archive/project/note.md", "archive/project/sibling.md"]),
    ).toBe(7);
  });

  it("skips a candidate edited between snapshot and rewrite, and still records the alias", async () => {
    const { root, service, knowledge } = boot();
    await service.write("target.md", "# Target\n");
    await service.write("a.md", "Links to [[target]].\n");
    await knowledge.settle();

    // the edit lands inside the rename step, before any rewrite runs.
    const racing: VaultService = {
      ...service,
      rename: async (from, to) => {
        const moved = await service.rename(from, to);
        await service.write("a.md", "Edited concurrently [[target]].\n");
        return moved;
      },
    };

    const result = await renameNoteWithLinkRewrite({
      from: "target.md",
      knowledge,
      service: racing,
      to: "moved.md",
    });
    expect(result.rewritten).toEqual([]);
    expect(result.skipped).toEqual([{ path: "a.md", reason: "changed" }]);
    expect(readFileSync(path.join(root, "a.md"), "utf-8")).toBe(
      "Edited concurrently [[target]].\n",
    );
    const moved = readFileSync(path.join(root, "moved.md"), "utf-8");
    expect(moved).toContain("aliases:");
    expect(moved).toContain("target");
  });
});
