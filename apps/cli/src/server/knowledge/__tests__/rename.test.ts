import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { describe, expect, it, onTestFinished } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService } from "../../vault/vault-service";
import type { VaultService } from "../../vault/vault-service";
import { createKnowledgeRuntime } from "../knowledge-runtime";
import type { KnowledgeRuntime } from "../knowledge-runtime";
import { renameNoteWithLinkRewrite } from "../rename";
import { identityLock } from "../../__tests__/identity-lock";
import { createInlineProjector } from "./inline-projector";

const boot = () => {
  const instanceDir = makeTempDir("inteligir-knowledge-rename-");
  const root = path.join(instanceDir, "vault");
  const dataDir = path.join(instanceDir, "data");
  mkdirSync(root, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  let sink: KnowledgeRuntime | null = null;
  const service = createVaultService({
    lock: identityLock,
    notifier: noopNotifier,
    onMutated: (mutations) =>
      sink?.noteVaultChange({ kind: "paths", paths: mutations.map((mutation) => mutation.path) }),
    root,
  });
  const knowledge = createKnowledgeRuntime({
    dataDir,
    projector: createInlineProjector(),
    vault: service,
    vaultRoot: root,
  });
  sink = knowledge;
  onTestFinished(async () => {
    await knowledge.dispose();
  });
  return { knowledge, root, service };
};

const noRebind = (): void => {};

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
      rebindThreads: noRebind,
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
      rebindThreads: noRebind,
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
      rebindThreads: noRebind,
      service,
      to: "Retro.md",
    });
    expect(result.rewritten).toEqual(["hub.md"]);
    expect(readFileSync(path.join(root, "hub.md"), "utf-8")).toBe("see [[notes/owner|Retro]]\n");
    const backlinks = await knowledge.backlinks("notes/owner.md");
    expect(backlinks.map((entry) => entry.sourcePath)).toEqual(["hub.md"]);
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
    const unresolved = async () => {
      const problems = await knowledge.problems({ limit: 10 });
      return [...problems.unresolvedLinks.rows, ...problems.missingEmbeds.rows];
    };
    expect(await unresolved()).toEqual([]);

    const rebound: [string, string][] = [];
    const result = await renameNoteWithLinkRewrite({
      from: "proj",
      knowledge,
      rebindThreads: (from, to) => {
        rebound.push([from, to]);
      },
      service,
      to: "archive/project",
    });
    expect(result.path).toBe("archive/project");
    expect(result.rewritten.toSorted()).toEqual(["archive/project/note.md", "hub.md"]);
    expect(result.skipped).toEqual([]);
    expect(rebound).toEqual([["proj", "archive/project"]]);

    expect(readFileSync(path.join(root, "hub.md"), "utf-8")).toBe(
      "Read [the note](archive/project/note.md), [[note]], ![[sibling]].\n",
    );
    expect(readFileSync(path.join(root, "archive", "project", "note.md"), "utf-8")).toBe(
      "# Note\n\nUp to [hub](../../hub.md), across [sib](sibling.md) and [[sibling]].\n",
    );
    expect(readFileSync(path.join(root, "archive", "project", "sibling.md"), "utf-8")).toBe(
      "# Sibling\n\nBack to [[note]].\n",
    );
    expect(await unresolved()).toEqual([]);
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
      rebindThreads: noRebind,
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
