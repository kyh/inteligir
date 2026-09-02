import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { PROJECTION_VERSION } from "@repo/notes/knowledge/projection";
import { VAULT_MAX_CONTENT_LENGTH } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it, onTestFinished } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService, type VaultService } from "../../vault/vault-service";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "../knowledge-runtime";
import { createSqliteDriver } from "../sqlite-driver";
import { identityLock } from "../../__tests__/identity-lock";

function makeDirs() {
  const instanceDir = makeTempDir("inteligir-knowledge-runtime-");
  const root = join(instanceDir, "vault");
  const dataDir = join(instanceDir, "data");
  mkdirSync(root, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  return { root, dataDir };
}

function boot(dirs: ReturnType<typeof makeDirs>) {
  let sink: KnowledgeRuntime | null = null;
  const service = createVaultService({
    root: dirs.root,
    lock: identityLock,
    notifier: noopNotifier,
    onMutated: (paths) => sink?.noteVaultChange({ kind: "paths", paths }),
  });
  const knowledge = createKnowledgeRuntime({
    dataDir: dirs.dataDir,
    vault: service,
    vaultRoot: dirs.root,
  });
  sink = knowledge;
  onTestFinished(() => knowledge.dispose());
  return { service, knowledge };
}

describe("the knowledge runtime", () => {
  it("indexes a write, answers search/backlinks/tags, and drops a delete", async () => {
    const { service, knowledge } = boot(makeDirs());

    await service.write("alpha.md", "# Alpha\n\nMentions [[beta]] and #project work.\n");
    await service.write("beta.md", "# Beta\n\nQuokka research notes.\n");

    const hits = await knowledge.search({ query: "quokka", limit: 10 });
    expect(hits.map((h) => h.path)).toEqual(["beta.md"]);

    const backlinks = await knowledge.backlinks("beta.md");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]?.sourcePath).toBe("alpha.md");
    expect(backlinks[0]?.kind).toBe("wiki");

    expect(await knowledge.tags()).toEqual([{ tag: "project", count: 1 }]);

    const tagged = await knowledge.search({ query: "", tag: "project", limit: 10 });
    expect(tagged.map((h) => h.path)).toEqual(["alpha.md"]);
    expect(await knowledge.search({ query: "quokka", tag: "project", limit: 10 })).toEqual([]);

    await service.remove("beta.md");
    expect(await knowledge.search({ query: "quokka", limit: 10 })).toEqual([]);
    expect(await knowledge.backlinks("beta.md")).toEqual([]);
  });

  it("never indexes Trash/ — a trashed note stops answering, a restored one resumes", async () => {
    const { service, knowledge } = boot(makeDirs());

    await service.write("hub.md", "See [[gamma]].\n");
    await service.write("gamma.md", "# Gamma\n\nAxolotl notes.\n");
    expect((await knowledge.search({ query: "axolotl", limit: 10 })).map((h) => h.path)).toEqual([
      "gamma.md",
    ]);

    // a trash is a rename into Trash/, announced as a created file.
    await service.rename("gamma.md", "Trash/gamma.md");
    expect(await knowledge.search({ query: "axolotl", limit: 10 })).toEqual([]);
    expect(await knowledge.backlinks("gamma.md")).toEqual([]);
    expect((await knowledge.wikiTargets()).some((target) => target.path.startsWith("Trash/"))).toBe(
      false,
    );

    await service.rename("Trash/gamma.md", "gamma.md");
    expect((await knowledge.search({ query: "axolotl", limit: 10 })).map((h) => h.path)).toEqual([
      "gamma.md",
    ]);
  });

  it("re-indexes a directory rename from its announced paths", async () => {
    const { service, knowledge } = boot(makeDirs());
    await service.write("notes/one.md", "# One\n\nWombat facts.\n");
    await service.write("notes/two.md", "# Two\n\nMore wombat facts.\n");
    await knowledge.settle();

    await service.rename("notes", "archive");
    const hits = await knowledge.search({ query: "wombat", limit: 10 });
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
      listTree: () => {
        listTreeCalls += 1;
        return service.listTree();
      },
      statEntry: (path) => service.statEntry(path),
      listFilesUnder: (path) => service.listFilesUnder(path),
      readBytes: (path) => service.readBytes(path),
    };
    const knowledge = createKnowledgeRuntime({
      dataDir: dirs.dataDir,
      vault: counted,
      vaultRoot: dirs.root,
    });
    onTestFinished(() => knowledge.dispose());
    await knowledge.settle();
    const afterBoot = listTreeCalls;

    writeFileSync(join(dirs.root, "quoll.md"), "# Quoll\n\nQuoll sightings.\n");
    knowledge.noteVaultChange({ kind: "paths", paths: ["quoll.md"] });
    await knowledge.settle();
    expect((await knowledge.search({ query: "quoll", limit: 10 })).map((h) => h.path)).toEqual([
      "quoll.md",
    ]);
    expect(listTreeCalls).toBe(afterBoot);
  });

  it("reconciles offline mutations at boot with an exact hash diff", async () => {
    const dirs = makeDirs();
    writeFileSync(join(dirs.root, "kept.md"), "# Kept\n\nStable content.\n");
    writeFileSync(join(dirs.root, "changed.md"), "# Changed\n\nOriginal words.\n");
    writeFileSync(join(dirs.root, "doomed.md"), "# Doomed\n");
    writeFileSync(join(dirs.root, "asset.png"), "not really a png");

    const first = boot(dirs);
    await first.knowledge.settle();
    expect(first.knowledge.lastReconcile).toEqual({ projected: 3, removed: 0, unchanged: 0 });
    await first.knowledge.dispose();

    writeFileSync(join(dirs.root, "changed.md"), "# Changed\n\nRewritten axolotl words.\n");
    writeFileSync(join(dirs.root, "created.md"), "# Created\n\nBrand new capybara.\n");
    rmSync(join(dirs.root, "doomed.md"));

    const second = boot(dirs);
    await second.knowledge.settle();
    expect(second.knowledge.lastReconcile).toEqual({ projected: 2, removed: 1, unchanged: 1 });

    expect(
      (await second.knowledge.search({ query: "axolotl", limit: 10 })).map((h) => h.path),
    ).toEqual(["changed.md"]);
    expect(
      (await second.knowledge.search({ query: "capybara", limit: 10 })).map((h) => h.path),
    ).toEqual(["created.md"]);
    expect(await second.knowledge.search({ query: "doomed", limit: 10 })).toEqual([]);
  });

  it("treats a pathless change announcement as a reconcile", async () => {
    const dirs = makeDirs();
    const { knowledge } = boot(dirs);
    await knowledge.settle();

    writeFileSync(join(dirs.root, "pulled.md"), "# Pulled\n\nNarwhal sighting.\n");
    knowledge.noteVaultChange({ kind: "unknown" });

    const hits = await knowledge.search({ query: "narwhal", limit: 10 });
    expect(hits.map((h) => h.path)).toEqual(["pulled.md"]);
  });

  it("rebuilds from the vault when the index file was corrupted between runs", async () => {
    const dirs = makeDirs();
    writeFileSync(join(dirs.root, "note.md"), "# Note\n\nPangolin data.\n");
    const first = boot(dirs);
    await first.knowledge.settle();
    expect(first.knowledge.lastReconcile?.projected).toBe(1);
    // dispose first: an open connection's page cache would mask the corruption.
    await first.knowledge.dispose();

    writeFileSync(join(dirs.dataDir, "knowledge.db"), "garbage bytes");

    const second = boot(dirs);
    await second.knowledge.settle();
    expect(second.knowledge.lastReconcile).toEqual({ projected: 1, removed: 0, unchanged: 0 });
    const hits = await second.knowledge.search({ query: "pangolin", limit: 10 });
    expect(hits.map((h) => h.path)).toEqual(["note.md"]);
  });

  it("rebuilds from the vault when the stored projection version is not this build's", async () => {
    const dirs = makeDirs();
    writeFileSync(join(dirs.root, "note.md"), "# Note\n\nTapir data.\n");
    const first = boot(dirs);
    await first.knowledge.settle();
    expect(first.knowledge.lastReconcile?.projected).toBe(1);
    await first.knowledge.dispose();

    const driver = createSqliteDriver(join(dirs.dataDir, "knowledge.db"));
    driver.run("UPDATE meta SET value = ? WHERE key = 'projection_version'", [
      String(PROJECTION_VERSION - 1),
    ]);
    driver.close();

    const second = boot(dirs);
    await second.knowledge.settle();
    expect(second.knowledge.lastReconcile).toEqual({ projected: 1, removed: 0, unchanged: 0 });
    expect(
      (await second.knowledge.search({ query: "tapir", limit: 10 })).map((h) => h.path),
    ).toEqual(["note.md"]);
  });

  it("converges a doc that crosses the read-cap boundary in both directions", async () => {
    const dirs = makeDirs();
    const { service, knowledge } = boot(dirs);
    const oversized = `# Big\n\n${"x".repeat(VAULT_MAX_CONTENT_LENGTH)}`;

    writeFileSync(join(dirs.root, "big.md"), oversized);
    knowledge.noteVaultChange({ kind: "paths", paths: ["big.md"] });
    await knowledge.settle();
    expect(await knowledge.search({ query: "big", limit: 10 })).toEqual([]);

    await service.write("big.md", "# Big\n\nNow small ocelot.\n");
    const found = await knowledge.search({ query: "ocelot", limit: 10 });
    expect(found.map((h) => h.path)).toEqual(["big.md"]);

    writeFileSync(join(dirs.root, "big.md"), oversized);
    knowledge.noteVaultChange({ kind: "paths", paths: ["big.md"] });
    await knowledge.settle();
    expect(await knowledge.search({ query: "ocelot", limit: 10 })).toEqual([]);
  });

  it("rebuilds before answering the query whose pass failed", async () => {
    const dirs = makeDirs();
    writeFileSync(join(dirs.root, "a.md"), "# A\n\nIbis notes.\n");
    const service = createVaultService({
      lock: identityLock,
      notifier: noopNotifier,
      root: dirs.root,
    });
    let failNextRead = false;
    const flaky: Pick<VaultService, "listTree" | "statEntry" | "listFilesUnder" | "readBytes"> = {
      listTree: () => service.listTree(),
      statEntry: (path) => service.statEntry(path),
      listFilesUnder: (path) => service.listFilesUnder(path),
      readBytes: (path) => {
        if (failNextRead) {
          failNextRead = false;
          return Promise.reject(new Error("transient io failure"));
        }
        return service.readBytes(path);
      },
    };
    const knowledge = createKnowledgeRuntime({
      dataDir: dirs.dataDir,
      vault: flaky,
      vaultRoot: dirs.root,
    });
    onTestFinished(() => knowledge.dispose());
    await knowledge.settle();

    writeFileSync(join(dirs.root, "b.md"), "# B\n\nHeron notes.\n");
    failNextRead = true;
    knowledge.noteVaultChange({ kind: "paths", paths: ["b.md"] });
    const hits = await knowledge.search({ query: "heron", limit: 10 });
    expect(hits.map((h) => h.path)).toEqual(["b.md"]);
  });
});
