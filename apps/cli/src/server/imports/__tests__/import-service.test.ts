import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import { itemFactsOf } from "@repo/notes/items/item-frontmatter";
import { urlKey } from "@repo/notes/items/item-url";
import { freeDocPath } from "@repo/notes/knowledge/doc-file";

import { makeTempDir } from "../../__tests__/temp-dir";
import type { ItemCore } from "../../items/item-core";
import { createImportService, IMPORT_BATCH_SIZE } from "../import-service";
import type { ImportServiceDeps } from "../import-service";
import { ImportsError } from "../imports-error";

const NOW = new Date(Date.UTC(2026, 9, 17, 9, 0, 0));

const csvOf = (count: number, row: (index: number) => string = () => ""): Uint8Array => {
  const lines = ["title,url,folder,cover,highlights"];
  for (let index = 0; index < count; index += 1) {
    lines.push(
      `Item ${String(index)},https://example.com/item-${String(index)},Reading,${row(index)}`,
    );
  }
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
};

const unreachable = (): never => {
  throw new Error("the import never asks this of its core");
};

interface Pause {
  reached: Promise<void>;
  release: () => void;
}

// a library in memory: the items the core created, every call it was asked, in order
const fakeLibrary = () => {
  const files = new Map<string, string>();
  const byKey = new Map<string, string>();
  const calls: string[] = [];
  let listings = 0;
  let pause: { at: number; release: Promise<void>; reached: () => void } | null = null;
  const core: ItemCore = {
    commitPaths: unreachable,
    async createDoc({ content, folder, name, stem }) {
      if (pause !== null && files.size === pause.at) {
        pause.reached();
        await pause.release;
      }
      const path = name === undefined ? freeDocPath(folder, stem, [...files.keys()]) : name(stem);
      files.set(path, content);
      const key = urlKey(itemFactsOf(content).url ?? "");
      if (key !== null) {
        byKey.set(key, path);
      }
      calls.push(`doc ${path}`);
      return await Promise.resolve({ path });
    },
    creatorOf: unreachable,
    async existing(url) {
      const key = urlKey(url);
      const path = key === null ? undefined : byKey.get(key);
      return await Promise.resolve(
        path === undefined ? null : { fill: { state: "pending" }, path },
      );
    },
    async folderNamer(folder) {
      listings += 1;
      const taken = [...files.keys()];
      return await Promise.resolve((stem: string) => {
        const path = freeDocPath(folder, stem, taken);
        taken.push(path);
        return path;
      });
    },
    freePath: unreachable,
    isTracked: unreachable,
    newId: unreachable,
    now: () => NOW,
    read: unreachable,
    remove: unreachable,
    rename: unreachable,
    syncNow: unreachable,
    syncsWithAccount: unreachable,
    withUrlLock: async (_key, run) => await run(),
    write: unreachable,
    writeContentAddressed: unreachable,
    writeOriginal: unreachable,
  };
  return {
    byKey,
    calls,
    core,
    files,
    listings: () => listings,
    // the next createDoc once `at` items exist waits for the returned release
    pauseAt(at: number): Pause {
      const reached: PromiseWithResolvers<void> = Promise.withResolvers();
      const released: PromiseWithResolvers<void> = Promise.withResolvers();
      pause = { at, reached: reached.resolve, release: released.promise };
      return { reached: reached.promise, release: released.resolve };
    },
  };
};

const boot = (options: { dataDir?: string; library?: ReturnType<typeof fakeLibrary> } = {}) => {
  const dataDir = options.dataDir ?? makeTempDir("inteligir-import-");
  const library = options.library ?? fakeLibrary();
  let settles = 0;
  let ids = 0;
  const commits: string[][] = [];
  const claims: string[][] = [];
  const fills: { item: { id: string; path: string; url: string }; hints?: { cover?: string } }[] =
    [];
  const deps: ImportServiceDeps = {
    annotations: {
      async addUnanchored({ entries, itemId }) {
        library.calls.push(`store ${itemId} ${String(entries.length)}`);
        return await Promise.resolve({
          answer: { path: annotationsStorePath(itemId) },
          wrote: [annotationsStorePath(itemId)],
        });
      },
    },
    core: library.core,
    dataDir,
    git: {
      async commitPaths(paths) {
        commits.push([...paths]);
        return await Promise.resolve({ files: paths.length });
      },
      holdCommits: () => ({
        claim: (paths) => {
          claims.push([...paths]);
        },
        release: () => {},
      }),
    },
    items: {
      enqueueFill(item, hints) {
        fills.push(hints === undefined ? { item } : { hints, item });
      },
    },
    knowledge: {
      findByUrl: unreachable,
      async settle() {
        settles += 1;
        await Promise.resolve();
      },
    },
    newId: () => {
      ids += 1;
      return `0000000${String(ids)}-0000-4000-8000-000000000000`.slice(-36);
    },
    notify: () => {},
    now: () => NOW,
  };
  const service = createImportService(deps);
  const finished = async () => {
    for (;;) {
      const job = await service.status();
      if (job?.state !== "running") {
        return job;
      }
      await delay(2);
    }
  };
  return {
    claims,
    commits,
    dataDir,
    fills,
    finished,
    library,
    service,
    settles: () => settles,
  };
};

describe("the Raindrop plan", () => {
  it("counts what the import would add, and what the library already holds", async () => {
    const library = fakeLibrary();
    library.byKey.set("example.com/item-1", "Reading/Item 1.md");
    const { service, dataDir } = boot({ library });
    const plan = await service.plan(
      "raindrop",
      csvOf(4, (index) => (index === 2 ? ',"Highlight: one\nHighlight: two"' : "")),
    );
    expect(plan).toMatchObject({
      alreadySaved: 1,
      estimatedBytes: 3 * 64 * 1024,
      folderCount: 1,
      folders: ["Reading"],
      highlights: 2,
      items: 3,
      skippedCount: 0,
    });
    expect(existsSync(nodePath.join(dataDir, "imports", `${plan.planId}.csv`))).toBe(true);
  });

  it("refuses a file that is no Raindrop export with its reason", async () => {
    const { service } = boot();
    await expect(
      service.plan("raindrop", new TextEncoder().encode("title,link\nA,b\n")),
    ).rejects.toMatchObject({ code: "unreadable", reason: "no-url-column" });
  });

  it("refuses a plan id it never made, or one already started", async () => {
    const { service, finished } = boot();
    await expect(service.start("../../escape")).rejects.toBeInstanceOf(ImportsError);
    const plan = await service.plan("raindrop", csvOf(1));
    await service.start(plan.planId);
    await finished();
    await expect(service.start(plan.planId)).rejects.toMatchObject({ code: "plan-gone" });
  });
});

describe("the import job", () => {
  it("writes batches of at most 100 items, each one commit under its hold", async () => {
    const { service, finished, commits, claims, library } = boot();
    const plan = await service.plan("raindrop", csvOf(250));
    await service.start(plan.planId);
    expect(await finished()).toMatchObject({
      added: 250,
      alreadySaved: 0,
      state: "done",
      total: 250,
    });
    expect(commits.map((paths) => paths.length)).toEqual([100, 100, 50]);
    expect(claims).toEqual(commits);
    expect(library.files.size).toBe(250);
  });

  it("settles once and lists a folder once per batch, however many rows share it", async () => {
    const { service, finished, settles, library } = boot();
    const plan = await service.plan("raindrop", csvOf(2000));
    const beforeSettles = settles();
    const beforeListings = library.listings();
    await service.start(plan.planId);
    await finished();
    expect(settles() - beforeSettles).toBe(2000 / IMPORT_BATCH_SIZE);
    expect(library.listings() - beforeListings).toBe(2000 / IMPORT_BATCH_SIZE);
  });

  it("hands each item to the fill with its Raindrop cover, and writes its store before it", async () => {
    const { service, finished, fills, library } = boot();
    const plan = await service.plan(
      "raindrop",
      csvOf(2, (index) => (index === 0 ? "https://cdn.example.com/cover.jpg,One quote" : "")),
    );
    await service.start(plan.planId);
    await finished();
    expect(fills.map(({ hints }) => hints)).toEqual([
      { cover: "https://cdn.example.com/cover.jpg" },
      undefined,
    ]);
    const firstId = fills[0]?.item.id ?? "";
    expect(library.calls.slice(0, 2)).toEqual([
      `store ${firstId} 1`,
      `doc ${fills[0]?.item.path ?? ""}`,
    ]);
    const content = library.files.get(fills[0]?.item.path ?? "") ?? "";
    expect(itemFactsOf(content)).toMatchObject({
      hasId: true,
      kind: "link",
      savedMs: NOW.getTime(),
    });
  });

  it("persists its cursor per batch and resumes a crash without adding anything twice", async () => {
    const library = fakeLibrary();
    const first = boot({ library });
    const plan = await first.service.plan("raindrop", csvOf(250));
    const paused = library.pauseAt(150);
    await first.service.start(plan.planId);
    await paused.reached;
    const jobFile = nodePath.join(first.dataDir, "imports", "job.json");
    const stale = readFileSync(jobFile, "utf-8");
    expect(JSON.parse(stale).job).toMatchObject({ added: 100, cursor: 100, state: "running" });
    // the crash: the process stops mid-batch, and the cursor on disk is a batch behind the items
    // the library holds
    const stopped = first.service.dispose();
    paused.release();
    await stopped;
    writeFileSync(jobFile, stale);
    const second = boot({ dataDir: first.dataDir, library });
    second.service.boot();
    expect(await second.finished()).toMatchObject({ state: "done" });
    expect(library.files.size).toBe(250);
    const created = library.calls.filter((call) => call.startsWith("doc "));
    expect(new Set(created).size).toBe(created.length);
  });

  it("stops between batches when cancelled", async () => {
    const library = fakeLibrary();
    const { service, finished } = boot({ library });
    const plan = await service.plan("raindrop", csvOf(350));
    const paused = library.pauseAt(150);
    const started = await service.start(plan.planId);
    await paused.reached;
    const cancelling = service.cancel(started.id);
    paused.release();
    expect(await cancelling).toMatchObject({ added: 200, state: "cancelled" });
    expect(await finished()).toMatchObject({ state: "cancelled" });
    expect(library.files.size).toBe(200);
  });

  it("refuses a second start while one runs, and cancels only its own job", async () => {
    const library = fakeLibrary();
    const { service } = boot({ library });
    const first = await service.plan("raindrop", csvOf(150));
    const second = await service.plan("raindrop", csvOf(1));
    const paused = library.pauseAt(10);
    const job = await service.start(first.planId);
    await paused.reached;
    await expect(service.start(second.planId)).rejects.toMatchObject({ code: "running" });
    await expect(service.cancel("another")).rejects.toMatchObject({ code: "job-not-found" });
    paused.release();
    await service.cancel(job.id);
  });

  it("removes its copy of the file when it ends", async () => {
    const { service, finished, dataDir } = boot();
    const plan = await service.plan("raindrop", csvOf(3));
    await service.start(plan.planId);
    await finished();
    expect(readdirSync(nodePath.join(dataDir, "imports"))).toEqual(["job.json"]);
  });
});
