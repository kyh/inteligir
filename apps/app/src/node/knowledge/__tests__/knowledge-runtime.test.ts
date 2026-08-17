// The projection pipeline over a real vault service: mutation → announced
// paths → projectDoc → store write → queryable, plus the boot reconcile's
// exact hash diff (unchanged docs are never re-projected).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noopNotifier } from "@repo/db/notifier";
import { VAULT_MAX_CONTENT_LENGTH } from "@repo/server-contract/vault";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService, type VaultService } from "../../vault/vault-service";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "../knowledge-runtime";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

function makeDirs(): { root: string; dataDir: string } {
  const instanceDir = makeTempDir("inteligir-knowledge-runtime-");
  const root = join(instanceDir, "vault");
  const dataDir = join(instanceDir, "data");
  mkdirSync(root, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  return { root, dataDir };
}

/** A service + runtime pair wired the way production wires them: every
 * service mutation announces its paths into the runtime. */
function boot(dirs: { root: string; dataDir: string }): {
  service: VaultService;
  knowledge: KnowledgeRuntime;
} {
  let sink: KnowledgeRuntime | null = null;
  const service = createVaultService({
    root: dirs.root,
    notifier: noopNotifier,
    onMutated: (paths) => sink?.noteVaultChange({ kind: "paths", paths }),
  });
  const knowledge = createKnowledgeRuntime({
    dataDir: dirs.dataDir,
    vault: service,
    vaultRoot: dirs.root,
  });
  sink = knowledge;
  cleanups.push(() => knowledge.dispose());
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

    // Text ∧ tag composition: the tag narrows, the text ranks within it.
    const tagged = await knowledge.search({ query: "", tag: "project", limit: 10 });
    expect(tagged.map((h) => h.path)).toEqual(["alpha.md"]);
    expect(await knowledge.search({ query: "quokka", tag: "project", limit: 10 })).toEqual([]);

    await service.remove("beta.md");
    expect(await knowledge.search({ query: "quokka", limit: 10 })).toEqual([]);
    expect(await knowledge.backlinks("beta.md")).toEqual([]);
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
    const service = createVaultService({ root: dirs.root, notifier: noopNotifier });
    let listTreeCalls = 0;
    const counted: Pick<VaultService, "listTree" | "statEntry" | "listFilesUnder" | "read"> = {
      listTree: () => {
        listTreeCalls += 1;
        return service.listTree();
      },
      statEntry: (path) => service.statEntry(path),
      listFilesUnder: (path) => service.listFilesUnder(path),
      read: (path) => service.read(path),
    };
    const knowledge = createKnowledgeRuntime({
      dataDir: dirs.dataDir,
      vault: counted,
      vaultRoot: dirs.root,
    });
    cleanups.push(() => knowledge.dispose());
    // The boot reconcile is the one listing; everything after it is targeted.
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

    // Mutations while the runtime is down: one edit, one create, one delete.
    writeFileSync(join(dirs.root, "changed.md"), "# Changed\n\nRewritten axolotl words.\n");
    writeFileSync(join(dirs.root, "created.md"), "# Created\n\nBrand new capybara.\n");
    rmSync(join(dirs.root, "doomed.md"));

    const second = boot(dirs);
    await second.knowledge.settle();
    // Exactness is the point: the untouched doc is diffed by hash, never
    // re-projected.
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

    // A change the runtime never saw paths for (a git pull's rebase).
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
    // Dispose closes the connection — no pre-corruption statement cache or
    // page cache can satisfy the second boot.
    await first.knowledge.dispose();

    writeFileSync(join(dirs.dataDir, "knowledge.db"), "garbage bytes");

    const second = boot(dirs);
    await second.knowledge.settle();
    // Proof the store was actually reset: nothing hydrated, everything
    // re-projected from the vault. A surviving cache would report
    // unchanged: 1, projected: 0.
    expect(second.knowledge.lastReconcile).toEqual({ projected: 1, removed: 0, unchanged: 0 });
    const hits = await second.knowledge.search({ query: "pangolin", limit: 10 });
    expect(hits.map((h) => h.path)).toEqual(["note.md"]);
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

    // The step that used to leave stale state: back over the cap, the doc
    // bookkeeping (hash + search row) must be left, not shadowed.
    writeFileSync(join(dirs.root, "big.md"), oversized);
    knowledge.noteVaultChange({ kind: "paths", paths: ["big.md"] });
    await knowledge.settle();
    expect(await knowledge.search({ query: "ocelot", limit: 10 })).toEqual([]);
  });

  it("rebuilds before answering the query whose pass failed", async () => {
    const dirs = makeDirs();
    writeFileSync(join(dirs.root, "a.md"), "# A\n\nIbis notes.\n");
    const service = createVaultService({ root: dirs.root, notifier: noopNotifier });
    let failNextRead = false;
    const flaky: Pick<VaultService, "listTree" | "statEntry" | "listFilesUnder" | "read"> = {
      listTree: () => service.listTree(),
      statEntry: (path) => service.statEntry(path),
      listFilesUnder: (path) => service.listFilesUnder(path),
      read: (path) => {
        if (failNextRead) {
          failNextRead = false;
          return Promise.reject(new Error("transient io failure"));
        }
        return service.read(path);
      },
    };
    const knowledge = createKnowledgeRuntime({
      dataDir: dirs.dataDir,
      vault: flaky,
      vaultRoot: dirs.root,
    });
    cleanups.push(() => knowledge.dispose());
    await knowledge.settle();

    writeFileSync(join(dirs.root, "b.md"), "# B\n\nHeron notes.\n");
    failNextRead = true;
    knowledge.noteVaultChange({ kind: "paths", paths: ["b.md"] });
    // The pass this settle flushes fails mid-read; the answer must come from
    // the rebuilt index, never from the just-nuked (empty) one.
    const hits = await knowledge.search({ query: "heron", limit: 10 });
    expect(hits.map((h) => h.path)).toEqual(["b.md"]);
  });
});
