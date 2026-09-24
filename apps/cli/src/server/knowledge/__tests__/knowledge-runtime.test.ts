import { chmodSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { noopNotifier } from "@repo/domain/notifier";
import { PROJECTION_VERSION } from "@repo/notes/knowledge/projection";
import { VAULT_MAX_CONTENT_LENGTH } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createVaultService } from "../../vault/vault-service";
import type { VaultService } from "../../vault/vault-service";
import { createKnowledgeRuntime } from "../knowledge-runtime";
import type { KnowledgeRuntime, KnowledgeRuntimeArgs } from "../knowledge-runtime";
import type { ProjectionResult } from "../projection-protocol";
import { createProjectionWorker, createProjector } from "../projector";
import { createSqliteDriver } from "../sqlite-driver";
import { identityLock } from "../../__tests__/identity-lock";
import { ignoreFromDisk } from "../../__tests__/ignore-from-disk";
import { bootIndexedVault, makeVaultDirs } from "./indexed-vault";
import { createInlineProjector } from "./inline-projector";

const searchPaths = async (knowledge: KnowledgeRuntime, query: string): Promise<string[]> => {
  const hits = await knowledge.search({ limit: 10, query });
  return hits.map((hit) => hit.path);
};

const makeDirs = () => makeVaultDirs("inteligir-knowledge-runtime-");

// the scan of this note holds a loop for seconds (2.9s measured, 6s on a loaded machine) and the
// rows it leaves this thread write in tenths of one, so a loaded machine cannot fail the test and
// a scan back on this thread cannot pass it
const EVENT_LOOP_CEILING_MS = 1000;
// the histogram records the gap between two of its own timer ticks, so the work must sit between
// ticks: a tick before it, and the timers phase reached once after
const HISTOGRAM_RESOLUTION_MS = 10;

const hugeNote = (lines: number): string => {
  const out = ["# Field notes", ""];
  for (let entry = 0; out.length < lines; entry += 1) {
    if (entry % 40 === 0) {
      out.push(`## Day ${entry / 40}`, "");
    }
    out.push(`Entry ${entry} saw a quokka near [[Burrow ${entry % 50}]] #field`, "");
  }
  return out.join("\n");
};

const recordingReads =
  (reads: string[]) =>
  (service: VaultService): KnowledgeRuntimeArgs["vault"] => ({
    ...service,
    readBytes: async (path) => {
      reads.push(path);
      return await service.readBytes(path);
    },
  });

describe("the knowledge runtime", () => {
  it("indexes a write, answers search/backlinks/tags, and drops a delete", async () => {
    const { service, knowledge } = bootIndexedVault(makeDirs());

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

  it("filters search by a tag's family, as the rail lists it, titled from the index", async () => {
    const { service, knowledge } = bootIndexedVault(makeDirs());
    await service.write("top.md", "# Top Level\n\nWombat #area here.\n");
    await service.write("deep.md", "# Deep Dive\n\nWombat #area/deep here.\n");
    await service.write("elsewhere.md", "# Elsewhere\n\nWombat #areas here.\n");

    const tagged = await knowledge.search({ limit: 10, query: "", tag: "area" });
    expect(tagged.map((hit) => [hit.path, hit.title])).toEqual([
      ["deep.md", "Deep Dive"],
      ["top.md", "Top Level"],
    ]);
    const ranked = await knowledge.search({ limit: 10, query: "wombat", tag: "area" });
    expect(ranked.map((hit) => hit.path).toSorted()).toEqual(["deep.md", "top.md"]);
  });

  it("re-indexes a directory rename from its announced paths, reading each doc once", async () => {
    const reads: string[] = [];
    const { service, knowledge } = bootIndexedVault(makeDirs(), { reader: recordingReads(reads) });
    await service.write("notes/one.md", "# One\n\nWombat facts.\n");
    await service.write("notes/two.md", "# Two\n\nMore wombat facts.\n");
    await knowledge.settle();
    reads.splice(0);

    await service.rename("notes", "archive");
    // a watcher announces the folder and the files inside it together
    knowledge.noteVaultChange({ kind: "paths", paths: ["archive/one.md", "archive/two.md"] });
    const hits = await knowledge.search({ limit: 10, query: "wombat" });
    expect(hits.map((h) => h.path).toSorted()).toEqual(["archive/one.md", "archive/two.md"]);
    expect(reads.toSorted()).toEqual(["archive/one.md", "archive/two.md"]);
  });

  it("drops exactly the announced deletions", async () => {
    const { service, knowledge } = bootIndexedVault(makeDirs());
    for (const name of ["n0", "n1", "n2", "n3", "n4", "n5"]) {
      await service.write(`${name}.md`, `# ${name}\n\nKiwi sighting.\n`);
    }
    await service.write("gone/inner.md", "# Inner\n\nKiwi sighting.\n");
    await service.write("gone-not/kept.md", "# Kept\n\nKiwi sighting.\n");
    await knowledge.settle();

    for (const path of ["n1.md", "n3.md", "n5.md", "gone"]) {
      await service.remove(path);
    }
    const kept = await searchPaths(knowledge, "kiwi");
    expect(kept.toSorted()).toEqual(["gone-not/kept.md", "n0.md", "n2.md", "n4.md"]);
  });

  it("indexes an announced batch by STATTING it, never by listing the vault", async () => {
    const dirs = makeDirs();
    const service = createVaultService({
      ignore: ignoreFromDisk(dirs.root),
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
      projector: createInlineProjector(),
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

    const first = bootIndexedVault(dirs);
    await first.knowledge.settle();
    expect(first.knowledge.lastReconcile).toMatchObject({
      deferred: 0,
      listed: 4,
      projected: 3,
      removed: 0,
      unchanged: 0,
    });
    await first.knowledge.dispose();

    writeFileSync(
      nodePath.join(dirs.root, "changed.md"),
      "# Changed\n\nRewritten axolotl words.\n",
    );
    writeFileSync(nodePath.join(dirs.root, "created.md"), "# Created\n\nBrand new capybara.\n");
    rmSync(nodePath.join(dirs.root, "doomed.md"));

    const second = bootIndexedVault(dirs);
    await second.knowledge.settle();
    expect(second.knowledge.lastReconcile).toMatchObject({
      deferred: 0,
      listed: 4,
      projected: 2,
      removed: 1,
      unchanged: 1,
    });

    expect(await searchPaths(second.knowledge, "axolotl")).toEqual(["changed.md"]);
    expect(await searchPaths(second.knowledge, "capybara")).toEqual(["created.md"]);
    expect(await second.knowledge.search({ limit: 10, query: "doomed" })).toEqual([]);
  });

  it("treats a pathless change announcement as a reconcile", async () => {
    const dirs = makeDirs();
    const { knowledge } = bootIndexedVault(dirs);
    await knowledge.settle();

    writeFileSync(nodePath.join(dirs.root, "pulled.md"), "# Pulled\n\nNarwhal sighting.\n");
    knowledge.noteVaultChange({ kind: "unknown" });

    const hits = await knowledge.search({ limit: 10, query: "narwhal" });
    expect(hits.map((h) => h.path)).toEqual(["pulled.md"]);
  });

  it("never reads or indexes a doc the vault's .gitignore names, until the rule goes", async () => {
    const dirs = makeDirs();
    mkdirSync(nodePath.join(dirs.root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(nodePath.join(dirs.root, ".gitignore"), "node_modules/\n");
    writeFileSync(nodePath.join(dirs.root, "node_modules", "pkg", "README.md"), "Wombat docs.\n");
    writeFileSync(nodePath.join(dirs.root, "note.md"), "# Note\n\nWombat sighting.\n");
    const reads: string[] = [];
    const { knowledge, service } = bootIndexedVault(dirs, { reader: recordingReads(reads) });

    expect(await searchPaths(knowledge, "wombat")).toEqual(["note.md"]);
    await service.write("node_modules/pkg/CHANGELOG.md", "Wombat release.\n");
    expect(await searchPaths(knowledge, "wombat")).toEqual(["note.md"]);
    expect(reads.filter((path) => path.startsWith("node_modules/"))).toEqual([]);

    writeFileSync(nodePath.join(dirs.root, ".gitignore"), "");
    knowledge.noteVaultChange({ kind: "unknown" });
    const revealed = await searchPaths(knowledge, "wombat");
    expect(revealed.toSorted()).toEqual([
      "node_modules/pkg/CHANGELOG.md",
      "node_modules/pkg/README.md",
      "note.md",
    ]);
  });

  it("rebuilds from the vault when the index file was corrupted between runs", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "note.md"), "# Note\n\nPangolin data.\n");
    const first = bootIndexedVault(dirs);
    await first.knowledge.settle();
    expect(first.knowledge.lastReconcile?.projected).toBe(1);
    // dispose first: an open connection's page cache would mask the corruption.
    await first.knowledge.dispose();

    writeFileSync(nodePath.join(dirs.dataDir, "knowledge.db"), "garbage bytes");

    const second = bootIndexedVault(dirs);
    await second.knowledge.settle();
    expect(second.knowledge.lastReconcile).toMatchObject({
      projected: 1,
      removed: 0,
      unchanged: 0,
    });
    const hits = await second.knowledge.search({ limit: 10, query: "pangolin" });
    expect(hits.map((h) => h.path)).toEqual(["note.md"]);
  });

  it("rebuilds from the vault when the stored projection version is not this build's", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "note.md"), "# Note\n\nTapir data.\n");
    const first = bootIndexedVault(dirs);
    await first.knowledge.settle();
    expect(first.knowledge.lastReconcile?.projected).toBe(1);
    await first.knowledge.dispose();

    const driver = createSqliteDriver(nodePath.join(dirs.dataDir, "knowledge.db"));
    driver.run("UPDATE meta SET value = ? WHERE key = 'projection_version'", [
      String(PROJECTION_VERSION - 1),
    ]);
    driver.close();

    const second = bootIndexedVault(dirs);
    await second.knowledge.settle();
    expect(second.knowledge.lastReconcile).toMatchObject({
      projected: 1,
      removed: 0,
      unchanged: 0,
    });
    expect(await searchPaths(second.knowledge, "tapir")).toEqual(["note.md"]);
  });

  it("converges a doc that crosses the read-cap boundary in both directions", async () => {
    const dirs = makeDirs();
    const { service, knowledge } = bootIndexedVault(dirs);
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

  it("rebuilds before answering the query whose pass the store failed", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "a.md"), "# A\n\nIbis notes.\n");
    const { service, knowledge } = bootIndexedVault(dirs);
    await knowledge.settle();

    // a second connection pulls the table out from under the runtime's own.
    const saboteur = createSqliteDriver(nodePath.join(dirs.dataDir, "knowledge.db"));
    saboteur.exec("DROP TABLE files");
    saboteur.close();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      /* empty */
    });
    onTestFinished(() => {
      warn.mockRestore();
    });

    await service.write("b.md", "# B\n\nHeron notes.\n");
    expect(await searchPaths(knowledge, "heron")).toEqual(["b.md"]);
    expect(await searchPaths(knowledge, "ibis")).toEqual(["a.md"]);
    expect(warn).toHaveBeenCalledWith(
      "[knowledge] the index store failed — rebuilding it:",
      expect.stringContaining("no such table: files"),
    );
  });

  it("leaves the index standing when a pass fails for any other reason", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "a.md"), "# A\n\nIbis notes.\n");
    let failNextListing = false;
    const { knowledge } = bootIndexedVault(dirs, {
      reader: (service) => ({
        ...service,
        listTree: async () => {
          if (failNextListing) {
            failNextListing = false;
            throw new Error("transient io failure");
          }
          return await service.listTree();
        },
      }),
    });
    await knowledge.settle();
    const indexFile = nodePath.join(dirs.dataDir, "knowledge.db");
    const indexInode = statSync(indexFile).ino;

    writeFileSync(nodePath.join(dirs.root, "b.md"), "# B\n\nHeron notes.\n");
    failNextListing = true;
    knowledge.noteVaultChange({ kind: "unknown" });
    await expect(knowledge.search({ limit: 10, query: "heron" })).rejects.toThrow(
      "transient io failure",
    );
    expect(statSync(indexFile).ino).toBe(indexInode);

    expect(await searchPaths(knowledge, "heron")).toEqual(["b.md"]);
    expect(knowledge.lastReconcile).toMatchObject({ projected: 1, removed: 0, unchanged: 1 });
  });

  it("keeps an unreadable doc's last entry without a rebuild, and indexes it once readable", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "a.md"), "# A\n\nIbis notes.\n");
    const locked = nodePath.join(dirs.root, "b.md");
    writeFileSync(locked, "# B\n\nHeron notes.\n");
    const { knowledge } = bootIndexedVault(dirs);
    await knowledge.settle();
    const indexFile = nodePath.join(dirs.dataDir, "knowledge.db");
    const indexInode = statSync(indexFile).ino;

    writeFileSync(locked, "# B\n\nHeron and egret notes.\n");
    chmodSync(locked, 0o000);
    knowledge.noteVaultChange({ kind: "unknown" });
    expect(await searchPaths(knowledge, "ibis")).toEqual(["a.md"]);
    expect(await searchPaths(knowledge, "heron")).toEqual(["b.md"]);
    expect(await searchPaths(knowledge, "egret")).toEqual([]);
    expect(statSync(indexFile).ino).toBe(indexInode);

    // a permission fix announces nothing; the next query's pass retries the path
    chmodSync(locked, 0o644);
    expect(await searchPaths(knowledge, "egret")).toEqual(["b.md"]);
  });

  it("indexes a doc its scan cannot project as an other, and answers for the rest", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "a.md"), "# A\n\nKestrel notes on [[b]].\n");
    writeFileSync(nodePath.join(dirs.root, "b.md"), "# B\n");
    // deep enough to overflow the parser's stack
    writeFileSync(nodePath.join(dirs.root, "deep.md"), `${">".repeat(10_000)} kestrel\n`);
    const reads: string[] = [];
    const { knowledge } = bootIndexedVault(dirs, { reader: recordingReads(reads) });

    expect(await searchPaths(knowledge, "kestrel")).toEqual(["a.md"]);
    const backlinks = await knowledge.backlinks("b.md");
    expect(backlinks.map((b) => b.sourcePath)).toEqual(["a.md"]);
    expect(await knowledge.renameCandidates(new Map([["b.md", "c.md"]]))).toContain("a.md");
    const readsAfterFirstPass = reads.length;
    expect(await searchPaths(knowledge, "kestrel")).toEqual(["a.md"]);
    expect(reads).toHaveLength(readsAfterFirstPass);

    knowledge.noteVaultChange({ kind: "unknown" });
    await knowledge.settle();
    expect(knowledge.lastReconcile).toMatchObject({ projected: 0, removed: 0, unchanged: 3 });
  });

  it("does not project a doc whose projection threw again after a restart", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "a.md"), "# A\n\nKestrel notes.\n");
    writeFileSync(nodePath.join(dirs.root, "deep.md"), `${">".repeat(10_000)} kestrel\n`);
    const first = bootIndexedVault(dirs);
    await first.knowledge.settle();
    expect(first.knowledge.lastReconcile).toMatchObject({ projected: 2, removed: 0, unchanged: 0 });
    await first.knowledge.dispose();

    const inline = createInlineProjector();
    const projected: string[] = [];
    const second = bootIndexedVault(dirs, {
      projector: {
        ...inline,
        project: async (docs) => {
          projected.push(...docs.map((doc) => doc.path));
          return await inline.project(docs);
        },
      },
    });
    expect(await searchPaths(second.knowledge, "kestrel")).toEqual(["a.md"]);
    expect(second.knowledge.lastReconcile).toMatchObject({
      projected: 0,
      removed: 0,
      unchanged: 2,
    });
    expect(projected).toEqual([]);

    writeFileSync(nodePath.join(dirs.root, "deep.md"), "# Deep\n\nNow shallow kestrel.\n");
    second.knowledge.noteVaultChange({ kind: "paths", paths: ["deep.md"] });
    expect(await searchPaths(second.knowledge, "shallow")).toEqual(["deep.md"]);
  });

  it("stops a reconcile within a step of dispose, and never reopens the index after", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "kept.md"), "# Kept\n");
    const reads: string[] = [];
    let watching = false;
    const firstRead: PromiseWithResolvers<void> = Promise.withResolvers();
    const { knowledge } = bootIndexedVault(dirs, {
      reader: (service) => ({
        ...service,
        readBytes: async (path) => {
          if (watching) {
            firstRead.resolve();
          }
          reads.push(path);
          return await service.readBytes(path);
        },
      }),
    });
    await knowledge.settle();

    const docCount = 600;
    for (let index = 0; index < docCount; index += 1) {
      writeFileSync(nodePath.join(dirs.root, `n${index}.md`), `# N${index}\n`);
    }
    reads.splice(0);
    watching = true;
    knowledge.noteVaultChange({ kind: "unknown" });
    const settling = knowledge.settle();
    await firstRead.promise;
    await knowledge.dispose();
    await settling;
    expect(reads.length).toBeLessThan(docCount);

    await expect(knowledge.search({ limit: 10, query: "n1" })).rejects.toThrow();
    const driver = createSqliteDriver(nodePath.join(dirs.dataDir, "knowledge.db"));
    onTestFinished(() => {
      driver.close();
    });
    expect(driver.all("SELECT path FROM files WHERE path = 'kept.md'", [])).toHaveLength(1);
  });

  it("releases a pass mid-projection on dispose, never waiting the projection out", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "a.md"), "# A\n");
    const projecting: PromiseWithResolvers<void> = Promise.withResolvers();
    const released: PromiseWithResolvers<ProjectionResult> = Promise.withResolvers();
    // a projection that never finishes on its own: dispose() hangs unless it stops the projector first
    const wedged = createProjector({
      dispose: async () => {
        released.reject(new Error("disposed"));
      },
      run: async () => {
        projecting.resolve();
        return await released.promise;
      },
    });
    const { knowledge } = bootIndexedVault(dirs, { projector: wedged });

    const settling = knowledge.settle();
    await projecting.promise;
    await knowledge.dispose();
    await expect(settling).resolves.toBeUndefined();
  });

  it("keeps the event loop free while a 20k-line note projects", async () => {
    const { service, knowledge } = bootIndexedVault(makeDirs(), {
      projector: createProjectionWorker(),
    });
    // the worker boots from source on its first job, and the boot is not what is measured
    await service.write("warm.md", "# Warm\n");
    await knowledge.settle();

    const loop = monitorEventLoopDelay({ resolution: HISTOGRAM_RESOLUTION_MS });
    loop.enable();
    await delay(HISTOGRAM_RESOLUTION_MS * 2);
    await service.write("field-notes.md", hugeNote(20_000));
    const hits = await searchPaths(knowledge, "quokka");
    await delay(HISTOGRAM_RESOLUTION_MS * 2);
    loop.disable();

    expect(hits).toEqual(["field-notes.md"]);
    expect(loop.max / 1e6).toBeLessThan(EVENT_LOOP_CEILING_MS);
  }, 120_000);
});

// short enough that a suite never waits on it, long past any read of a temp dir
const SHORT_DEADLINE_MS = 50;
const PACED_READ_MS = 5;
const LANDING_TIMEOUT_MS = 10_000;
const DEFERRAL_TEST_TIMEOUT_MS = 30_000;

// a read of a stalled path takes its bytes, then answers only once `opened` resolves: what it
// lands is what the file held when it was opened.
const stallingReads =
  (stalled: ReadonlySet<string>, opened: Promise<void>, answered: string[] = []) =>
  (service: VaultService): KnowledgeRuntimeArgs["vault"] => ({
    ...service,
    readBytes: async (path) => {
      const read = await service.readBytes(path);
      if (stalled.has(path)) {
        await opened;
      }
      answered.push(path);
      return read;
    },
  });

describe("a read that has not answered by its deadline", () => {
  it(
    "is left out of the settle, and its doc is indexed once it lands",
    async () => {
      const dirs = makeDirs();
      writeFileSync(nodePath.join(dirs.root, "a-slow.md"), "# Slow\n\nSloth notes.\n");
      const fast = Array.from({ length: 30 }, (_, index) => `n${index}.md`);
      for (const path of fast) {
        writeFileSync(nodePath.join(dirs.root, path), `# ${path}\n\nIbis notes.\n`);
      }
      const opened: PromiseWithResolvers<void> = Promise.withResolvers();
      const { knowledge } = bootIndexedVault(dirs, {
        readDeadlineMs: SHORT_DEADLINE_MS,
        // every other read takes a few ms, so the batch is still being read past the deadline
        reader: (service) => {
          const stalling = stallingReads(new Set(["a-slow.md"]), opened.promise)(service);
          return {
            ...stalling,
            readBytes: async (path) => {
              await delay(PACED_READ_MS);
              return await stalling.readBytes(path);
            },
          };
        },
      });

      await knowledge.settle();
      expect(knowledge.lastReconcile).toMatchObject({
        deferred: 1,
        listed: fast.length + 1,
        projected: fast.length,
      });
      const ibis = await knowledge.search({ limit: fast.length, query: "ibis" });
      expect(ibis).toHaveLength(fast.length);
      expect(await searchPaths(knowledge, "sloth")).toEqual([]);

      opened.resolve();
      await vi.waitFor(
        async () => {
          expect(await searchPaths(knowledge, "sloth")).toEqual(["a-slow.md"]);
        },
        { timeout: LANDING_TIMEOUT_MS },
      );
    },
    DEFERRAL_TEST_TIMEOUT_MS,
  );

  it(
    "opens no more docs once the stalled ones fill the budget, and reads the rest as they land",
    async () => {
      const dirs = makeDirs();
      const paths = Array.from({ length: 12 }, (_, index) => `n${index}.md`);
      for (const path of paths) {
        writeFileSync(nodePath.join(dirs.root, path), `# ${path}\n\nMarmot notes.\n`);
      }
      const opened: PromiseWithResolvers<void> = Promise.withResolvers();
      const reads: string[] = [];
      const { knowledge } = bootIndexedVault(dirs, {
        readDeadlineMs: SHORT_DEADLINE_MS,
        reader: (service) => {
          const stalling = stallingReads(new Set(paths), opened.promise)(service);
          return {
            ...stalling,
            readBytes: async (path) => {
              reads.push(path);
              return await stalling.readBytes(path);
            },
          };
        },
      });

      await knowledge.settle();
      expect(knowledge.lastReconcile).toMatchObject({ deferred: paths.length, projected: 0 });
      expect(reads.length).toBeLessThan(paths.length);

      opened.resolve();
      await vi.waitFor(
        async () => {
          const hits = await knowledge.search({ limit: paths.length, query: "marmot" });
          expect(hits.map((hit) => hit.path).toSorted()).toEqual(paths.toSorted());
        },
        { timeout: LANDING_TIMEOUT_MS },
      );
    },
    DEFERRAL_TEST_TIMEOUT_MS,
  );

  it(
    "reads a doc again once it lands when the doc changed while the read was out",
    async () => {
      const dirs = makeDirs();
      const slow = nodePath.join(dirs.root, "slow.md");
      writeFileSync(slow, "# Slow\n\nSloth notes.\n");
      const opened: PromiseWithResolvers<void> = Promise.withResolvers();
      const { knowledge } = bootIndexedVault(dirs, {
        readDeadlineMs: SHORT_DEADLINE_MS,
        reader: stallingReads(new Set(["slow.md"]), opened.promise),
      });
      await knowledge.settle();

      writeFileSync(slow, "# Slow\n\nOkapi notes.\n");
      knowledge.noteVaultChange({ kind: "paths", paths: ["slow.md"] });
      await knowledge.settle();

      opened.resolve();
      await vi.waitFor(
        async () => {
          expect(await searchPaths(knowledge, "okapi")).toEqual(["slow.md"]);
        },
        { timeout: LANDING_TIMEOUT_MS },
      );
      expect(await searchPaths(knowledge, "sloth")).toEqual([]);
    },
    DEFERRAL_TEST_TIMEOUT_MS,
  );

  it(
    "never indexes what a read landed for a doc deleted while it was out",
    async () => {
      const dirs = makeDirs();
      const slow = nodePath.join(dirs.root, "slow.md");
      writeFileSync(slow, "# Slow\n\nSloth notes.\n");
      const opened: PromiseWithResolvers<void> = Promise.withResolvers();
      const answered: string[] = [];
      const { knowledge } = bootIndexedVault(dirs, {
        readDeadlineMs: SHORT_DEADLINE_MS,
        reader: stallingReads(new Set(["slow.md"]), opened.promise, answered),
      });
      await knowledge.settle();

      rmSync(slow);
      knowledge.noteVaultChange({ kind: "paths", paths: ["slow.md"] });
      await knowledge.settle();

      opened.resolve();
      await vi.waitFor(
        () => {
          expect(answered).toContain("slow.md");
        },
        { timeout: LANDING_TIMEOUT_MS },
      );
      expect(await searchPaths(knowledge, "sloth")).toEqual([]);
      const targets = await knowledge.wikiTargets();
      expect(targets.map((target) => target.path)).toEqual([]);
    },
    DEFERRAL_TEST_TIMEOUT_MS,
  );
});

describe("the knowledge runtime's debug trace", () => {
  it("names each file's verdict by its path, and never its content", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "kept.md"), "# Kept\n\nsecret quokka words\n");
    writeFileSync(nodePath.join(dirs.root, "asset.png"), "not really a png");
    const service = createVaultService({
      ignore: ignoreFromDisk(dirs.root),
      lock: identityLock,
      notifier: noopNotifier,
      root: dirs.root,
    });
    const lines: string[] = [];
    const knowledge = createKnowledgeRuntime({
      dataDir: dirs.dataDir,
      debugLog: (line) => {
        lines.push(line);
      },
      projector: createInlineProjector(),
      vault: service,
      vaultRoot: dirs.root,
    });
    onTestFinished(async () => {
      await knowledge.dispose();
    });
    await knowledge.settle();
    const atBoot = lines.length;
    expect(lines.toSorted()).toEqual([
      "asset.png: not a searchable doc, indexed as an other",
      "kept.md: changed, indexing",
    ]);

    rmSync(nodePath.join(dirs.root, "asset.png"));
    knowledge.noteVaultChange({ kind: "paths", paths: ["asset.png", "kept.md"] });
    await knowledge.settle();
    expect(lines.slice(atBoot)).toEqual([
      "asset.png: gone, removed with anything under it",
      "kept.md: unchanged, skipped",
    ]);
    expect(lines.join("\n")).not.toContain("quokka");
  });
});

describe("unlinked mentions", () => {
  it("names the notes that spell this one in prose, and drops one once it links", async () => {
    const { service, knowledge } = bootIndexedVault(makeDirs());
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

  it("answers the target a Link writes, qualified when the bare name is another note's", async () => {
    const { service, knowledge } = bootIndexedVault(makeDirs());
    await service.write("Plan.md", "# Plan\n");
    await service.write("zz/Plan.md", "# The other plan\n");
    await service.write("zz/Solo.md", "# Solo\n");

    const shadowed = await knowledge.unlinkedMentions("zz/Plan.md", 10);
    const unique = await knowledge.unlinkedMentions("zz/Solo.md", 10);
    expect(shadowed.linkTarget).toBe("zz/Plan");
    expect(unique.linkTarget).toBe("Solo");
  });
});

describe("vault problems", () => {
  it("lists a dangling link once with its source, and drops it once the note exists", async () => {
    const { service, knowledge } = bootIndexedVault(makeDirs());
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
