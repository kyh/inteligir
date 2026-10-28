// A Raindrop export read into the library (`@repo/notes/imports/raindrop`): the first run reads
// the CSV into its plan, one row per bookmark, keyed once by its address; each later run lands a
// page of them. A bookmark lands as an unread link, its tags and folder Raindrop's, its note the
// item's note and its highlights waiting for the page's text, which the cloud reads after it
// (`./cell-fills`), Raindrop's own picture tried after the page's; an address the library holds
// already is counted, not saved twice.

import { parseRaindropCsv, planRaindropImport } from "@repo/notes/imports/raindrop";
import type { PlannedItem } from "@repo/notes/imports/raindrop";
import { UNSORTED_FOLDER } from "@repo/notes/items/item-kind";
import { itemNameFromUrl } from "@repo/notes/items/item-name";
import { kindForUrl } from "@repo/notes/items/item-url";
import { ITEM_FIELD_CAPS } from "@repo/notes/library/library-item";
import { z } from "zod";

import { blobKey } from "./cell-blobs";
import { cellCodec } from "./cell-codec";
import { askFill } from "./cell-fills";
import { folderOfTarget } from "./cell-folders";
import type { FolderTarget } from "./cell-folders";
import { apart, DONE, failed, importActor, LIBRARY_FULL, MORE, PAGE_MS } from "./cell-import-host";
import type { ImportHost, StepOutcome } from "./cell-import-host";
import { advanceImport, importRows, putImportRows } from "./cell-import-jobs";
import type { ImportJob } from "./cell-import-jobs";
import { blankFields, landNew, noteBlocksOf } from "./cell-items";
import type { AddOp } from "./cell-items";
import { urlHolder } from "./cell-landing";
import type { LandingScope } from "./cell-landing";

// what a Raindrop export may be: its CSV is read whole, and one of 100,000 bookmarks is a few MB
export const RAINDROP_MAX_BYTES = 16 * 1024 * 1024;

// the bookmarks one run lands
const PAGE_ROWS = 100;

const ROW = "bookmark";

const UNREADABLE: Readonly<Record<"not-csv" | "no-url-column" | "empty", string>> = {
  empty: "This file has no bookmarks in it.",
  "no-url-column":
    "This file isn't a Raindrop export: it has no column of web addresses. In Raindrop, open Settings › Backups, create a backup and choose its CSV file.",
  "not-csv":
    "This file isn't a Raindrop export. In Raindrop, open Settings › Backups, create a backup and choose its CSV file.",
};

const plannedSchema = z.object({
  cover: z.string().nullable(),
  description: z.string().nullable(),
  folder: z.string(),
  highlights: z.array(z.object({ quote: z.string(), text: z.string() })),
  key: z.string(),
  note: z.string(),
  pinned: z.boolean(),
  savedMs: z.number(),
  savedSeconds: z.number(),
  tags: z.array(z.string()),
  title: z.string().nullable(),
  url: z.string(),
});
type Planned = z.infer<typeof plannedSchema>;

const plannedOf = (item: PlannedItem): Planned => ({
  cover: item.cover,
  description: item.description,
  folder: item.folder,
  highlights: item.highlights,
  key: item.key,
  note: item.note,
  pinned: item.pinned,
  savedMs: item.savedMs,
  savedSeconds: item.savedSeconds,
  tags: item.tags,
  title: item.title,
  url: item.url,
});

// Raindrop's folder as the library's, a name cut to what a folder holds; its Unsorted is none
const folderOf = (folder: string): FolderTarget =>
  folder === UNSORTED_FOLDER
    ? null
    : {
        path: folder
          .split("/")
          .map((name) => name.trim().slice(0, 255))
          .join("/"),
      };

// the first run: the CSV read into the plan, its rows counted
const readExport = async (host: ImportHost, job: ImportJob): Promise<StepOutcome> => {
  const object = await host.env.BLOBS.get(blobKey(host.accountId, job.sha));
  if (object === null) {
    return failed("The file to import is no longer in the library. Choose it again.");
  }
  const parse = parseRaindropCsv(await object.text());
  if (!parse.ok) {
    return failed(UNREADABLE[parse.reason]);
  }
  const plan = planRaindropImport(parse.rows, host.now());
  const written = apart(host.library, (scope) => {
    putImportRows(
      scope.storage,
      job.id,
      ROW,
      plan.items.map((item, idx) => ({ idx, value: plannedOf(item) })),
    );
    advanceImport(scope.storage, job.id, {
      counts: { alreadySaved: plan.duplicates, skipped: parse.skipped.length },
      cursor: 0,
      phase: "landing",
      total: parse.rows.length + parse.skipped.length,
    });
  });
  return written ? MORE : DONE;
};

interface Landed {
  readonly kind: "added" | "held";
  readonly highlights: number;
}

// one bookmark as an unread link, or counted as held when its address is the library's already
const landBookmark = (
  scope: LandingScope,
  host: ImportHost,
  job: ImportJob,
  planned: Planned,
): Landed => {
  if (urlHolder(scope.storage, planned.key, null) !== null) {
    return { highlights: 0, kind: "held" };
  }
  const { library } = host;
  const actor = importActor(job);
  const note =
    planned.note === ""
      ? null
      : noteBlocksOf(scope, cellCodec(scope.storage, library.ids), planned.note);
  const highlights = planned.highlights.map((highlight): AddOp => ({
    createdAt: planned.savedSeconds,
    id: library.ids.annotation(),
    occurrence: null,
    op: "add",
    parentId: null,
    quote: highlight.quote,
    text: highlight.text,
  }));
  const item = landNew(scope, actor, {
    annotations: [...(note?.highlights ?? []), ...highlights],
    blocks: note?.blocks ?? [],
    fields: {
      ...blankFields(scope.now),
      description: planned.description,
      fetchState: "pending",
      folderId: folderOfTarget(scope, folderOf(planned.folder), library.ids.item) ?? null,
      kind: kindForUrl(planned.url),
      pinnedAt: planned.pinned ? planned.savedMs : null,
      savedAt: planned.savedMs,
      tags: planned.tags,
      title: (planned.title ?? itemNameFromUrl(planned.url)).slice(0, ITEM_FIELD_CAPS.line),
      url: planned.url,
    },
    id: library.ids.item(),
  });
  askFill(scope, item, planned.cover);
  return { highlights: highlights.length, kind: "added" };
};

const LANDED = z.object({ highlights: z.number(), kind: z.enum(["added", "held"]) });

// a page of bookmarks, each in a transaction with the job's cursor, so a run cut off part way
// lands none twice
const landPage = (host: ImportHost, job: ImportJob, startedAt: number): StepOutcome => {
  const { library } = host;
  const page = library.read((sql) =>
    importRows(sql, job.id, ROW, { from: job.cursor, limit: PAGE_ROWS }, plannedSchema),
  );
  if (!page.ok) {
    return DONE;
  }
  if (page.value.length === 0) {
    return DONE;
  }
  for (const { idx, value } of page.value) {
    const landed = library.land(importActor(job), { answer: LANDED, opId: undefined }, (scope) => {
      const result = landBookmark(scope, host, job, value);
      advanceImport(scope.storage, job.id, {
        changeSetId: result.kind === "added" ? scope.set().id : undefined,
        counts:
          result.kind === "added"
            ? { added: 1, highlights: result.highlights }
            : { alreadySaved: 1 },
        cursor: idx + 1,
      });
      return result;
    });
    if (!landed.ok) {
      if (landed.refusal.kind === "gone") {
        return DONE;
      }
      if (landed.refusal.kind === "quota") {
        return failed(LIBRARY_FULL);
      }
      apart(library, (scope) => {
        advanceImport(scope.storage, job.id, { counts: { unreadable: 1 }, cursor: idx + 1 });
      });
    }
    if (host.now() - startedAt > PAGE_MS) {
      return MORE;
    }
  }
  // a page short of a whole one was the last
  return page.value.length < PAGE_ROWS ? DONE : MORE;
};

export const stepRaindrop = async (host: ImportHost, job: ImportJob): Promise<StepOutcome> =>
  job.phase === "reading" ? await readExport(host, job) : landPage(host, job, host.now());
