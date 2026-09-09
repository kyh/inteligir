import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { PROJECTION_VERSION } from "@repo/notes/knowledge/projection";
import { VAULT_MAX_CONTENT_LENGTH } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it, onTestFinished } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService } from "../../vault/vault-service";
import type { VaultService } from "../../vault/vault-service";
import { createKnowledgeRuntime } from "../knowledge-runtime";
import type { KnowledgeRuntime } from "../knowledge-runtime";
import { createSqliteDriver } from "../sqlite-driver";
import { identityLock } from "../../__tests__/identity-lock";

const searchPaths = async (knowledge: KnowledgeRuntime, query: string): Promise<string[]> => {
  const hits = await knowledge.search({ limit: 10, query });
  return hits.map((hit) => hit.path);
};

const makeDirs = () => {
  const instanceDir = makeTempDir("inteligir-knowledge-runtime-");
  const root = nodePath.join(instanceDir, "vault");
  const dataDir = nodePath.join(instanceDir, "data");
  mkdirSync(root, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  return { dataDir, root };
};

const boot = (dirs: ReturnType<typeof makeDirs>) => {
  let sink: KnowledgeRuntime | null = null;
  const service = createVaultService({
    lock: identityLock,
    notifier: noopNotifier,
    onMutated: (paths) => sink?.noteVaultChange({ kind: "paths", paths }),
    root: dirs.root,
  });
  const knowledge = createKnowledgeRuntime({
    dataDir: dirs.dataDir,
    vault: service,
    vaultRoot: dirs.root,
  });
  sink = knowledge;
  onTestFinished(async () => {
    await knowledge.dispose();
  });
  return { knowledge, service };
};

describe("the knowledge runtime", () => {
  it("indexes a write, answers search/backlinks/tags, and drops a delete", async () => {
    const { service, knowledge } = boot(makeDirs());

    await service.write("alpha.md", "# Alpha\n\nMentions [[beta]] and #project work.\n");
    await service.write("beta.md", "# Beta\n\nQuokka research notes.\n");

    const hits = await knowledge.search({ limit: 10, query: "quokka" });
    expect(hits.map((h) => h.path)).toEqual(["beta.md"]);

    const backlinks = await knowledge.backlinks("beta.md");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]?.sourcePath).toBe("alpha.md");
    expect(backlinks[0]?.kind).toBe("wiki");

    expect(await knowledge.tags()).toEqual([{ count: 1, tag: "project" }]);

    const tagged = await knowledge.search({ limit: 10, query: "", tag: "project" });
    expect(tagged.map((h) => h.path)).toEqual(["alpha.md"]);
    expect(await knowledge.search({ limit: 10, query: "quokka", tag: "project" })).toEqual([]);

    await service.remove("beta.md");
    expect(await knowledge.search({ limit: 10, query: "quokka" })).toEqual([]);
    expect(await knowledge.backlinks("beta.md")).toEqual([]);
  });

  it("re-indexes a directory rename from its announced paths", async () => {
    const { service, knowledge } = boot(makeDirs());
    await service.write("notes/one.md", "# One\n\nWombat facts.\n");
    await service.write("notes/two.md", "# Two\n\nMore wombat facts.\n");
    await knowledge.settle();

    await service.rename("notes", "archive");
    const hits = await knowledge.search({ limit: 10, query: "wombat" });
    expect(hits.map((h) => h.path).toSorted()).toEqual(["archive/one.md", "archive/two.md"]);
  });

  it("indexes an announced batch by STATTING it, never by listing the vault", async () => {
    const dirs = makeDirs();
    const service = createVaultService({
      lock: identityLock,
      notifier: noopNotifier,
      root: dirs.root,
    });
    let listTreeCalls = 0;
    const counted: Pick<VaultService, "listTree" | "statEntry" | "listFilesUnder" | "readBytes"> = {
      listFilesUnder: async (path) => await service.listFilesUnder(path),
      listTree: async () => {
        listTreeCalls += 1;
        return await service.listTree();
      },
      readBytes: async (path) => await service.readBytes(path),
      statEntry: async (path) => await service.statEntry(path),
    };
    const knowledge = createKnowledgeRuntime({
      dataDir: dirs.dataDir,
      vault: counted,
      vaultRoot: dirs.root,
    });
    onTestFinished(async () => {
      await knowledge.dispose();
    });
    await knowledge.settle();
    const afterBoot = listTreeCalls;

    writeFileSync(nodePath.join(dirs.root, "quoll.md"), "# Quoll\n\nQuoll sightings.\n");
    knowledge.noteVaultChange({ kind: "paths", paths: ["quoll.md"] });
    await knowledge.settle();
    expect(await searchPaths(knowledge, "quoll")).toEqual(["quoll.md"]);
    expect(listTreeCalls).toBe(afterBoot);
  });

  it("reconciles offline mutations at boot with an exact hash diff", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "kept.md"), "# Kept\n\nStable content.\n");
    writeFileSync(nodePath.join(dirs.root, "changed.md"), "# Changed\n\nOriginal words.\n");
    writeFileSync(nodePath.join(dirs.root, "doomed.md"), "# Doomed\n");
    writeFileSync(nodePath.join(dirs.root, "asset.png"), "not really a png");

    const first = boot(dirs);
    await first.knowledge.settle();
    expect(first.knowledge.lastReconcile).toEqual({ projected: 3, removed: 0, unchanged: 0 });
    await first.knowledge.dispose();

    writeFileSync(
      nodePath.join(dirs.root, "changed.md"),
      "# Changed\n\nRewritten axolotl words.\n",
    );
    writeFileSync(nodePath.join(dirs.root, "created.md"), "# Created\n\nBrand new capybara.\n");
    rmSync(nodePath.join(dirs.root, "doomed.md"));

    const second = boot(dirs);
    await second.knowledge.settle();
    expect(second.knowledge.lastReconcile).toEqual({ projected: 2, removed: 1, unchanged: 1 });

    expect(await searchPaths(second.knowledge, "axolotl")).toEqual(["changed.md"]);
    expect(await searchPaths(second.knowledge, "capybara")).toEqual(["created.md"]);
    expect(await second.knowledge.search({ limit: 10, query: "doomed" })).toEqual([]);
  });

  it("treats a pathless change announcement as a reconcile", async () => {
    const dirs = makeDirs();
    const { knowledge } = boot(dirs);
    await knowledge.settle();

    writeFileSync(nodePath.join(dirs.root, "pulled.md"), "# Pulled\n\nNarwhal sighting.\n");
    knowledge.noteVaultChange({ kind: "unknown" });

    const hits = await knowledge.search({ limit: 10, query: "narwhal" });
    expect(hits.map((h) => h.path)).toEqual(["pulled.md"]);
  });

  it("rebuilds from the vault when the index file was corrupted between runs", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "note.md"), "# Note\n\nPangolin data.\n");
    const first = boot(dirs);
    await first.knowledge.settle();
    expect(first.knowledge.lastReconcile?.projected).toBe(1);
    // dispose first: an open connection's page cache would mask the corruption.
    await first.knowledge.dispose();

    writeFileSync(nodePath.join(dirs.dataDir, "knowledge.db"), "garbage bytes");

    const second = boot(dirs);
    await second.knowledge.settle();
    expect(second.knowledge.lastReconcile).toEqual({ projected: 1, removed: 0, unchanged: 0 });
    const hits = await second.knowledge.search({ limit: 10, query: "pangolin" });
    expect(hits.map((h) => h.path)).toEqual(["note.md"]);
  });

  it("rebuilds from the vault when the stored projection version is not this build's", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "note.md"), "# Note\n\nTapir data.\n");
    const first = boot(dirs);
    await first.knowledge.settle();
    expect(first.knowledge.lastReconcile?.projected).toBe(1);
    await first.knowledge.dispose();

    const driver = createSqliteDriver(nodePath.join(dirs.dataDir, "knowledge.db"));
    driver.run("UPDATE meta SET value = ? WHERE key = 'projection_version'", [
      String(PROJECTION_VERSION - 1),
    ]);
    driver.close();

    const second = boot(dirs);
    await second.knowledge.settle();
    expect(second.knowledge.lastReconcile).toEqual({ projected: 1, removed: 0, unchanged: 0 });
    expect(await searchPaths(second.knowledge, "tapir")).toEqual(["note.md"]);
  });

  it("converges a doc that crosses the read-cap boundary in both directions", async () => {
    const dirs = makeDirs();
    const { service, knowledge } = boot(dirs);
    const oversized = `# Big\n\n${"x".repeat(VAULT_MAX_CONTENT_LENGTH)}`;

    writeFileSync(nodePath.join(dirs.root, "big.md"), oversized);
    knowledge.noteVaultChange({ kind: "paths", paths: ["big.md"] });
    await knowledge.settle();
    expect(await knowledge.search({ limit: 10, query: "big" })).toEqual([]);

    await service.write("big.md", "# Big\n\nNow small ocelot.\n");
    const found = await knowledge.search({ limit: 10, query: "ocelot" });
    expect(found.map((h) => h.path)).toEqual(["big.md"]);

    writeFileSync(nodePath.join(dirs.root, "big.md"), oversized);
    knowledge.noteVaultChange({ kind: "paths", paths: ["big.md"] });
    await knowledge.settle();
    expect(await knowledge.search({ limit: 10, query: "ocelot" })).toEqual([]);
  });

  it("rebuilds before answering the query whose pass failed", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "a.md"), "# A\n\nIbis notes.\n");
    const service = createVaultService({
      lock: identityLock,
      notifier: noopNotifier,
      root: dirs.root,
    });
    let failNextRead = false;
    const flaky: Pick<VaultService, "listTree" | "statEntry" | "listFilesUnder" | "readBytes"> = {
      listFilesUnder: async (path) => await service.listFilesUnder(path),
      listTree: async () => await service.listTree(),
      readBytes: async (path) => {
        if (failNextRead) {
          failNextRead = false;
          throw new Error("transient io failure");
        }
        return await service.readBytes(path);
      },
      statEntry: async (path) => await service.statEntry(path),
    };
    const knowledge = createKnowledgeRuntime({
      dataDir: dirs.dataDir,
      vault: flaky,
      vaultRoot: dirs.root,
    });
    onTestFinished(async () => {
      await knowledge.dispose();
    });
    await knowledge.settle();

    writeFileSync(nodePath.join(dirs.root, "b.md"), "# B\n\nHeron notes.\n");
    failNextRead = true;
    knowledge.noteVaultChange({ kind: "paths", paths: ["b.md"] });
    const hits = await knowledge.search({ limit: 10, query: "heron" });
    expect(hits.map((h) => h.path)).toEqual(["b.md"]);
  });
});

describe("unlinked mentions", () => {
  it("names the notes that spell this one in prose, and drops one once it links", async () => {
    const { service, knowledge } = boot(makeDirs());
    await service.write("Roadmap.md", "---\naliases: [the plan]\n---\n# Roadmap\n");
    await service.write("a.md", "We revisit the roadmap on Monday.\n");
    await service.write("b.md", "Follow the plan.\n");
    await service.write("c.md", "See [[Roadmap]] and the roadmap again.\n");
    await service.write("d.md", "`roadmap` in code only.\n");

    const found = await knowledge.unlinkedMentions("Roadmap.md", 10);
    expect(found.total).toBe(2);
    expect(found.mentions.map((mention) => [mention.path, mention.text])).toEqual([
      ["a.md", "roadmap"],
      ["b.md", "the plan"],
    ]);

    await service.write("a.md", "We revisit the [[Roadmap|roadmap]] on Monday.\n");
    const after = await knowledge.unlinkedMentions("Roadmap.md", 10);
    expect(after.mentions.map((mention) => mention.path)).toEqual(["b.md"]);
    const backlinks = await knowledge.backlinks("Roadmap.md");
    expect(backlinks.map((b) => b.sourcePath).toSorted()).toEqual(["a.md", "c.md"]);
  });
});

describe("vault problems", () => {
  it("lists a dangling link once with its source, and drops it once the note exists", async () => {
    const { service, knowledge } = boot(makeDirs());
    await service.write("Welcome.md", "# Welcome\n\nOpen [[Nowhere]] twice: [[nowhere]].\n");
    await service.write("Guide.md", "# Guide\n\nBack to [[Welcome]].\n");

    const before = await knowledge.problems({ limit: 10 });
    expect(
      before.unresolvedLinks.rows.map((row) => [row.sourcePath, row.target, row.line]),
    ).toEqual([["Welcome.md", "Nowhere", 3]]);
    expect(before.orphans.rows.map((row) => row.path)).toEqual(["Guide.md"]);

    // the new note is what Welcome linked to, so it is linked, not orphaned
    await service.write("Nowhere.md", "# Nowhere\n");
    const after = await knowledge.problems({ limit: 10 });
    expect(after.unresolvedLinks.rows).toEqual([]);
    expect(after.orphans.rows.map((row) => row.path)).toEqual(["Guide.md"]);
  });
});
