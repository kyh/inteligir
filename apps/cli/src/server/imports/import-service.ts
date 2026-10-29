// an import is a server job over a copy of the file: a plan reads it and answers what it would
// add, a start runs that plan in batches, and the job's counts reach the page as import-changed.
//
// The job is linear in its rows: each batch of 100 settles the index once, lists each folder it
// writes into once, keys every row with the plan's own url key, writes one store and one item per
// row, hands the item to the fill's pending store, and commits once. URL dedupe is what makes a
// resume safe, so the job is a json file of its cursor and counts, rewritten per batch, and a boot
// picks a running one up. The import fetches nothing: a Raindrop cover is a hint the fill tries.

import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import nodePath from "node:path";

import { z } from "zod";

import {
  IMPORT_ITEM_ESTIMATE_BYTES,
  IMPORT_LIST_MAX,
  importJobSchema,
} from "@repo/contract/local/imports/imports-schema";
import type {
  ImportJob,
  ImportSource,
  ImportsPlanResponse,
} from "@repo/contract/local/imports/imports-schema";
import { mintAnnotationId } from "@repo/notes/annotations/store-schema";
import { composeItemFile } from "@repo/notes/items/item-frontmatter";
import { UNSORTED_FOLDER } from "@repo/notes/items/item-kind";
import { kindForUrl } from "@repo/notes/items/item-url";

import type { AnnotationsService } from "../annotations/annotations-service";
import { messageOf } from "../error-message";
import type { FolderNamer, ItemCore } from "../items/item-core";
import { ItemsError } from "../items/items-error";
import type { ItemsService } from "../items/items-service";
import { JsonFileStore } from "../json-file-store";
import { stagedWriteFileSync } from "../staged-write";
import type { GitEngine } from "../vault/git-engine";
import { ENGINE_IDENTITY } from "../vault/git-run";
import { ImportsError } from "./imports-error";
import { parseRaindropCsv, planRaindropImport } from "@repo/notes/imports/raindrop";
import type { ImportPlan, PlannedItem, SkippedRow } from "@repo/notes/imports/raindrop";

export interface ImportService {
  // throws ImportsError "unreadable" with its reason
  plan: (source: ImportSource, bytes: Uint8Array) => Promise<ImportsPlanResponse>;
  start: (planId: string) => Promise<ImportJob>;
  // the latest job, or null when this library never imported
  status: () => Promise<ImportJob | null>;
  cancel: (id: string) => Promise<ImportJob>;
  // resumes a job a shutdown stopped between batches
  boot: () => void;
  dispose: () => Promise<void>;
}

export interface ImportServiceDeps {
  // the items service's own core, so an import and a save of one url share its lock
  core: ItemCore;
  items: Pick<ItemsService, "enqueueFill">;
  annotations: Pick<AnnotationsService, "addUnanchored">;
  // a batch commits as one, under a hold that keeps the auto-commit off its paths
  git: Pick<GitEngine, "holdCommits" | "commitPaths">;
  // bus.notifyVault(["import-changed"]), each time a job's counts or state move
  notify: () => void;
  dataDir: string;
  now: () => Date;
  newId: () => string;
}

export const IMPORT_BATCH_SIZE = 100;
// a plan's copy of the file is kept this long for its start
const PLAN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const IMPORTS_DIR = "imports";
const JOB_FILE = `${IMPORTS_DIR}/job.json`;
const COMMIT_SUBJECT = "Import from Raindrop";
// a plan id names a file, so one a caller sends is only ever a minted one's shape
const PLAN_ID_RE = /^[A-Za-z0-9-]{1,64}$/u;

// the job as the data dir keeps it: the wire's job, plus where the plan's file is and how far it got
const storedJobSchema = z.strictObject({
  ...importJobSchema.shape,
  cursor: z.number().int().min(0),
  planId: z.string().regex(PLAN_ID_RE),
});
type StoredJob = z.infer<typeof storedJobSchema>;
const jobFileSchema = z.strictObject({ job: storedJobSchema.nullable() });

const toWire = (job: StoredJob): ImportJob => {
  const { cursor: _cursor, planId: _planId, ...wire } = job;
  return wire;
};

interface PlanRead {
  plan: ImportPlan;
  skipped: SkippedRow[];
}

interface HeldPlan extends PlanRead {
  madeAt: number;
}

// the folder a batch writes an item into, and the namer that hands out its names
interface FolderTarget {
  folder: string;
  name: FolderNamer;
}

const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);

// the file's rows as a plan, or the reason it is no Raindrop export
const planOf = (text: string, now: number): PlanRead => {
  const parsed = parseRaindropCsv(text);
  if (!parsed.ok) {
    throw new ImportsError("unreadable", { reason: parsed.reason });
  }
  return { plan: planRaindropImport(parsed.rows, now), skipped: parsed.skipped };
};

const itemContent = (item: PlannedItem, id: string): string =>
  composeItemFile(
    {
      description: item.description,
      id,
      kind: kindForUrl(item.url),
      pinned: item.pinned,
      saved: item.saved,
      tags: item.tags,
      url: item.url,
    },
    item.note === "" ? "" : `${item.note}\n`,
  );

export const createImportService = (deps: ImportServiceDeps): ImportService => {
  const { core, dataDir } = deps;
  const importsDir = nodePath.join(dataDir, IMPORTS_DIR);
  const jobStore = new JsonFileStore({
    dataDir,
    empty: { job: null },
    fileName: JOB_FILE,
    schema: jobFileSchema,
  });
  const plans = new Map<string, HeldPlan>();
  let job: StoredJob | null = null;
  let loaded = false;
  let running: Promise<void> | null = null;
  let cancelRequested = false;
  let stopping = false;

  const csvPath = (planId: string): string => nodePath.join(importsDir, `${planId}.csv`);
  const removeCsv = (planId: string): void => {
    rmSync(csvPath(planId), { force: true });
  };

  const currentJob = (): StoredJob | null => {
    if (!loaded) {
      loaded = true;
      try {
        ({ job } = jobStore.read());
      } catch (error) {
        console.warn(`[imports] job file skipped: ${messageOf(error)}`);
        job = null;
      }
    }
    return job;
  };

  const save = (next: StoredJob): void => {
    job = next;
    jobStore.write({ job: next });
    deps.notify();
  };

  // the plan a file's copy holds, however old: a running job resumes from it
  const planFromDisk = (planId: string): HeldPlan | null => {
    try {
      const madeAt = statSync(csvPath(planId)).mtimeMs;
      return { ...planOf(readFileSync(csvPath(planId), "utf-8"), deps.now().getTime()), madeAt };
    } catch {
      return null;
    }
  };

  // a plan made in this process, else the copy of the file a plan left, while it is fresh
  const heldPlan = (planId: string): HeldPlan | null => {
    if (!PLAN_ID_RE.test(planId)) {
      return null;
    }
    const held = plans.get(planId) ?? planFromDisk(planId);
    return held !== null && deps.now().getTime() - held.madeAt <= PLAN_LIFETIME_MS ? held : null;
  };

  // one folder's namer per batch: one listing, then the names this batch hands out. a folder a
  // file stands in takes its items into Unsorted instead
  const namerFor = async (
    namers: Map<string, FolderTarget>,
    folder: string,
  ): Promise<FolderTarget> => {
    const known = namers.get(folder);
    if (known !== undefined) {
      return known;
    }
    let made: FolderTarget;
    try {
      made = { folder, name: await core.folderNamer(folder) };
    } catch (error) {
      if (!(error instanceof ItemsError) || folder === UNSORTED_FOLDER) {
        throw error;
      }
      made = await namerFor(namers, UNSORTED_FOLDER);
    }
    namers.set(folder, made);
    return made;
  };

  interface BatchCounts {
    added: number;
    alreadySaved: number;
    highlights: number;
    done: number;
  }

  // one item under its url's lock: a url the library holds counts as saved, anything else is its
  // annotations' store, then the item, then its pending fill
  const importItem = async (
    item: PlannedItem,
    namers: Map<string, FolderTarget>,
    wrote: string[],
    counts: BatchCounts,
  ): Promise<void> => {
    await core.withUrlLock(item.key, async () => {
      if ((await core.existing(item.url, { settle: false })) !== null) {
        counts.alreadySaved += 1;
        return;
      }
      const id = deps.newId();
      if (item.highlights.length > 0) {
        const stored = await deps.annotations.addUnanchored({
          entries: item.highlights.map((highlight) => ({
            createdAt: item.savedSeconds,
            id: mintAnnotationId(randomBytes),
            quote: highlight.quote,
            source: "user",
            text: highlight.text,
          })),
          itemId: id,
        });
        wrote.push(...stored.wrote);
      }
      const { folder, name } = await namerFor(namers, item.folder);
      const { path } = await core.createDoc({
        content: itemContent(item, id),
        folder,
        name,
        stem: item.stem,
      });
      wrote.push(path);
      deps.items.enqueueFill(
        { id, path, url: item.url },
        item.cover === null ? undefined : { cover: item.cover },
      );
      counts.added += 1;
      counts.highlights += item.highlights.length;
    });
  };

  // a batch from the cursor: one settle, one hold, a namer per folder, one commit. a shutdown
  // stops it after the item in hand, committing what it wrote
  const runBatch = async (plan: ImportPlan, cursor: number): Promise<BatchCounts> => {
    await core.settle();
    const hold = deps.git.holdCommits();
    const wrote: string[] = [];
    const counts: BatchCounts = { added: 0, alreadySaved: 0, done: 0, highlights: 0 };
    try {
      const namers = new Map<string, FolderTarget>();
      for (const item of plan.items.slice(cursor, cursor + IMPORT_BATCH_SIZE)) {
        if (stopping) {
          break;
        }
        await importItem(item, namers, wrote, counts);
        counts.done += 1;
      }
      if (wrote.length > 0) {
        hold.claim(wrote);
        await deps.git.commitPaths(wrote, ENGINE_IDENTITY, COMMIT_SUBJECT);
      }
    } finally {
      hold.release();
    }
    return counts;
  };

  const finish = (from: StoredJob, state: "done" | "cancelled" | "failed", message?: string) => {
    save({ ...from, finishedAt: deps.now().getTime(), message: message ?? null, state });
    removeCsv(from.planId);
  };

  const runJob = async (plan: ImportPlan, started: StoredJob): Promise<void> => {
    const at: StoredJob = { ...started };
    try {
      while (at.cursor < plan.items.length) {
        const counts = await runBatch(plan, at.cursor);
        Object.assign(at, {
          added: at.added + counts.added,
          alreadySaved: at.alreadySaved + counts.alreadySaved,
          cursor: at.cursor + counts.done,
          highlights: at.highlights + counts.highlights,
        });
        save({ ...at });
        if (stopping) {
          return;
        }
        if (cancelRequested) {
          finish(at, "cancelled");
          return;
        }
      }
      finish(at, "done");
    } catch (error) {
      console.warn(`[imports] the import stopped: ${messageOf(error)}`);
      finish(at, "failed", `The import stopped: ${messageOf(error)}`);
    }
  };

  const launch = (plan: ImportPlan, started: StoredJob): void => {
    cancelRequested = false;
    running = (async () => {
      try {
        await runJob(plan, started);
      } finally {
        running = null;
      }
    })();
  };

  // a plan's file and any older copy a plan never started, past its lifetime
  const sweepPlans = (keep: string | null): void => {
    let names: string[];
    try {
      names = readdirSync(importsDir);
    } catch {
      return;
    }
    const now = deps.now().getTime();
    for (const name of names) {
      const planId = name.endsWith(".csv") ? name.slice(0, -".csv".length) : null;
      if (planId === null || planId === keep) {
        continue;
      }
      try {
        if (now - statSync(nodePath.join(importsDir, name)).mtimeMs > PLAN_LIFETIME_MS) {
          removeCsv(planId);
        }
      } catch {
        // a file gone meanwhile is swept already
      }
    }
  };

  return {
    boot() {
      const stored = currentJob();
      const resuming = stored?.state === "running" ? stored : null;
      sweepPlans(resuming?.planId ?? null);
      if (resuming === null) {
        return;
      }
      const held = planFromDisk(resuming.planId);
      if (held === null) {
        finish(resuming, "failed", "The import stopped: its copy of the file is gone.");
        return;
      }
      launch(held.plan, resuming);
    },

    async cancel(id) {
      const stored = currentJob();
      if (stored === null || stored.id !== id) {
        throw new ImportsError("job-not-found");
      }
      if (stored.state !== "running" || running === null) {
        return toWire(stored);
      }
      cancelRequested = true;
      await running;
      const settled = currentJob();
      return toWire(settled ?? stored);
    },

    async dispose() {
      stopping = true;
      await running;
    },

    async plan(source, bytes) {
      const now = deps.now().getTime();
      const text = decode(bytes);
      const { plan, skipped } = planOf(text, now);
      await core.settle();
      const adding: PlannedItem[] = [];
      let alreadySaved = 0;
      for (const item of plan.items) {
        if ((await core.existing(item.url, { settle: false })) === null) {
          adding.push(item);
        } else {
          alreadySaved += 1;
        }
      }
      const planId = deps.newId();
      stagedWriteFileSync(csvPath(planId), text);
      plans.set(planId, { madeAt: now, plan, skipped });
      const folders = [...new Set(adding.map((item) => item.folder))];
      const tags = new Set(adding.flatMap((item) => item.tags.map((tag) => tag.toLowerCase())));
      return {
        alreadySaved,
        droppedTags: plan.droppedTags.slice(0, IMPORT_LIST_MAX),
        duplicates: plan.duplicates,
        estimatedBytes: adding.length * IMPORT_ITEM_ESTIMATE_BYTES,
        folderCount: folders.length,
        folders: folders.slice(0, 200),
        highlights: adding.reduce((sum, item) => sum + item.highlights.length, 0),
        items: adding.length,
        planId,
        skipped: skipped.slice(0, IMPORT_LIST_MAX),
        skippedCount: skipped.length,
        tags: tags.size,
      } satisfies ImportsPlanResponse;
    },

    async start(planId) {
      if (currentJob()?.state === "running") {
        throw new ImportsError("running");
      }
      const held = heldPlan(planId);
      if (held === null) {
        if (PLAN_ID_RE.test(planId)) {
          removeCsv(planId);
        }
        throw new ImportsError("plan-gone");
      }
      plans.delete(planId);
      const started: StoredJob = {
        added: 0,
        alreadySaved: 0,
        cursor: 0,
        finishedAt: null,
        highlights: 0,
        id: deps.newId(),
        message: null,
        planId,
        source: "raindrop",
        startedAt: deps.now().getTime(),
        state: "running",
        total: held.plan.items.length,
      };
      save(started);
      launch(held.plan, started);
      return await Promise.resolve(toWire(started));
    },

    async status() {
      const stored = currentJob();
      return await Promise.resolve(stored === null ? null : toWire(stored));
    },
  };
};
