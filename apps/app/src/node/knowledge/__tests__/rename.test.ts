// Rename + link rewrite over the vault service: exactly the candidate docs
// are rewritten (byte-stable everywhere else), the moved doc records its old
// stem as a frontmatter alias, and a shadowing rename qualifies the links it
// would steal.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noopNotifier } from "@repo/db/notifier";
import { afterEach, describe, expect, it } from "vitest";
import { createVaultService, type VaultService } from "../../vault/vault-service";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "../knowledge-runtime";
import { renameNoteWithLinkRewrite } from "../rename";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

function boot(): { root: string; service: VaultService; knowledge: KnowledgeRuntime } {
  const instanceDir = mkdtempSync(join(tmpdir(), "inteligir-knowledge-rename-"));
  cleanups.push(() => rmSync(instanceDir, { recursive: true, force: true }));
  const root = join(instanceDir, "vault");
  const dataDir = join(instanceDir, "data");
  mkdirSync(root, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  let sink: KnowledgeRuntime | null = null;
  const service = createVaultService({
    root,
    notifier: noopNotifier,
    onMutated: (paths) => sink?.noteVaultChange({ kind: "paths", paths }),
  });
  const knowledge = createKnowledgeRuntime({ dataDir, vault: service, vaultRoot: root });
  sink = knowledge;
  cleanups.push(() => knowledge.dispose());
  return { root, service, knowledge };
}

describe("rename with link rewrite", () => {
  it("rewrites exactly the candidate docs and records the old stem as an alias", async () => {
    const { root, service, knowledge } = boot();
    await service.write("notes/target.md", "# Target\n\nContent here.\n");
    await service.write("a.md", "Links to [[target]] today.\n");
    await service.write("b.md", "See [details](notes/target.md) for more.\n");
    await service.write("unrelated.md", "No links, though target is a word here.\n");

    const candidates = await knowledge.renameCandidates("notes/target.md", "archive/moved.md");
    expect(candidates.toSorted()).toEqual(["a.md", "b.md", "notes/target.md"]);

    const result = await renameNoteWithLinkRewrite({
      service,
      knowledge,
      from: "notes/target.md",
      to: "archive/moved.md",
    });
    expect(result.path).toBe("archive/moved.md");
    expect(result.rewritten.toSorted()).toEqual(["a.md", "b.md"]);
    expect(result.skipped).toEqual([]);

    expect(readFileSync(join(root, "a.md"), "utf8")).toBe("Links to [[moved]] today.\n");
    expect(readFileSync(join(root, "b.md"), "utf8")).toBe(
      "See [details](archive/moved.md) for more.\n",
    );
    // Byte-stable outside the candidate set.
    expect(readFileSync(join(root, "unrelated.md"), "utf8")).toBe(
      "No links, though target is a word here.\n",
    );
    // The moved doc gained the old stem as an alias, body preserved.
    const moved = readFileSync(join(root, "archive", "moved.md"), "utf8");
    expect(moved).toContain("aliases:");
    expect(moved).toContain("target");
    expect(moved.endsWith("# Target\n\nContent here.\n")).toBe(true);

    // The index followed the rewrite: the wiki link resolves to the new path.
    const backlinks = await knowledge.backlinks("archive/moved.md");
    expect(backlinks.map((entry) => entry.sourcePath).toSorted()).toEqual(["a.md", "b.md"]);
  });

  it("qualifies links a shadowing rename would steal", async () => {
    const { root, service, knowledge } = boot();
    await service.write("a/note.md", "# A note\n");
    await service.write("s.md", "Ref [[note]] here.\n");
    await service.write("other.md", "# Other\n");
    await knowledge.settle();

    const candidates = await knowledge.renameCandidates("other.md", "note.md");
    expect(candidates.toSorted()).toEqual(["other.md", "s.md"]);

    await renameNoteWithLinkRewrite({ service, knowledge, from: "other.md", to: "note.md" });

    // `[[note]]` used to reach a/note.md; the new root note.md would shadow
    // it, so the link is qualified to keep meaning what it meant.
    expect(readFileSync(join(root, "s.md"), "utf8")).toBe("Ref [[a/note]] here.\n");
    const backlinks = await knowledge.backlinks("a/note.md");
    expect(backlinks.map((entry) => entry.sourcePath)).toEqual(["s.md"]);
  });

  it("passes a directory rename straight through", async () => {
    const { root, service, knowledge } = boot();
    await service.write("dir/inner.md", "# Inner\n");
    await knowledge.settle();

    const result = await renameNoteWithLinkRewrite({
      service,
      knowledge,
      from: "dir",
      to: "moved-dir",
    });
    expect(result).toEqual({ path: "moved-dir", rewritten: [], skipped: [] });
    expect(readFileSync(join(root, "moved-dir", "inner.md"), "utf8")).toBe("# Inner\n");
  });

  it("skips a candidate edited between snapshot and rewrite, and still records the alias", async () => {
    const { root, service, knowledge } = boot();
    await service.write("target.md", "# Target\n");
    await service.write("a.md", "Links to [[target]].\n");
    await knowledge.settle();

    // A concurrent edit landing right after the move: the racing service
    // performs it inside the rename step, before any rewrite runs.
    const racing: VaultService = {
      ...service,
      rename: async (from, to) => {
        const moved = await service.rename(from, to);
        await service.write("a.md", "Edited concurrently [[target]].\n");
        return moved;
      },
    };

    const result = await renameNoteWithLinkRewrite({
      service: racing,
      knowledge,
      from: "target.md",
      to: "moved.md",
    });
    expect(result.rewritten).toEqual([]);
    expect(result.skipped).toEqual([{ path: "a.md", reason: "changed" }]);
    // The concurrent edit survived — never overwritten with snapshot bytes.
    expect(readFileSync(join(root, "a.md"), "utf8")).toBe("Edited concurrently [[target]].\n");
    // The alias fallback still landed despite the unrelated skip, so the
    // un-rewritten link keeps resolving.
    const moved = readFileSync(join(root, "moved.md"), "utf8");
    expect(moved).toContain("aliases:");
    expect(moved).toContain("target");
  });
});
