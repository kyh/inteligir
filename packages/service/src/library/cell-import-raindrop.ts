// A Raindrop export read into the library (`@repo/service/imports/raindrop`): the first run reads
// the CSV into its plan, one row per bookmark, keyed once by its address; each later run lands a
// page of them. A bookmark lands as an unread link, its tags and folder Raindrop's, its note and its
// highlights the item's note, its page read by the cloud after it (`./cell-fills`), Raindrop's own
// picture tried after the page's; an address the library holds already is counted, not saved
// twice.

import {
  highlightBlocks,
  parseRaindropCsv,
  planRaindropImport,
  plannedItemSchema,
} from "../imports/raindrop";
import type { PlannedItem } from "../imports/raindrop";
import { itemNameFromUrl } from "@repo/contract/items/item-name";
import { kindForUrl } from "@repo/contract/items/item-url";
import { ordsBetween } from "@repo/contract/library/block-order";
import { blankItemFields } from "@repo/contract/library/item-makes";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { z } from "zod";

import { blobKey } from "./cell-blobs";
import { cellCodec } from "./cell-codec";
import { askFill } from "./cell-fills";
import { folderOfTarget } from "./cell-folders";
import {
  apart,
  DONE,
  failed,
  FILE_GONE,
  importActor,
  landingOutcome,
  MORE,
  PAGE_MS,
} from "./cell-import-host";
import type { ImportHost, StepOutcome } from "./cell-import-host";
import { advanceImport, fitsImportRow, importRows, putImportRows } from "./cell-import-jobs";
import type { ImportJob } from "./cell-import-jobs";
import { landNew, noteBlocksOf } from "./cell-items";
import type { PlacedBlock } from "./cell-items";
import { urlHolder } from "./cell-landing";
import { refuse } from "./cell-refusal";
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

// the first run: the CSV read into the plan, its rows counted
const readExport = async (host: ImportHost, job: ImportJob): Promise<StepOutcome> => {
  const object = await host.env.BLOBS.get(blobKey(host.accountId, job.sha));
  if (object === null) {
    return failed(FILE_GONE);
  }
  const parse = parseRaindropCsv(await object.text());
  if (!parse.ok) {
    return failed(UNREADABLE[parse.reason]);
  }
  const plan = planRaindropImport(parse.rows, host.now());
  const rows = plan.items.map((value, idx) => ({ idx, value })).filter(fitsImportRow);
  const written = apart(host.library, (scope) => {
    putImportRows(scope.storage.db, job.id, ROW, rows);
    advanceImport(scope.storage.db, job.id, {
      counts: {
        alreadySaved: plan.duplicates,
        skipped: parse.skipped,
        unreadable: plan.items.length - rows.length,
      },
      cursor: 0,
      phase: "landing",
      total: parse.rows.length + parse.skipped,
    });
  });
  return written ? MORE : DONE;
};

type Landed = "added" | "held";

const inNote = (blocks: readonly LibraryBlock[]): PlacedBlock[] => {
  const ords = ordsBetween(null, null, blocks.length);
  return blocks.flatMap((block, index) => {
    const ord = ords[index];
    return ord === undefined ? [] : [{ block, ord, section: "note" as const }];
  });
};

// one bookmark as an unread link, or counted as held when its address is the library's already
const landBookmark = (scope: LandingScope, host: ImportHost, planned: PlannedItem): Landed => {
  if (urlHolder(scope.storage.db, planned.key, null) !== null) {
    return "held";
  }
  const { library } = host;
  const noted =
    planned.note === ""
      ? []
      : noteBlocksOf(scope, cellCodec(scope.storage.db, library.ids), planned.note);
  // a passage past what a block holds would land a block no device could write back
  const quoted = z
    .array(storableBlockSchema)
    .safeParse(highlightBlocks(planned.highlights, library.ids.block));
  if (!quoted.success) {
    return refuse({ kind: "too-large" });
  }
  const item = landNew(scope, {
    blocks: inNote([...noted.map((placed) => placed.block), ...quoted.data]),
    fields: {
      ...blankItemFields(scope.now),
      description: planned.description,
      fetchState: "pending",
      folderId:
        folderOfTarget(
          scope,
          planned.folder === null ? null : { path: planned.folder },
          library.ids.item,
        ) ?? null,
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
  return "added";
};

const LANDED = z.enum(["added", "held"]);

// a page of bookmarks, each in a transaction with the job's cursor, so a run cut off part way
// lands none twice
const landPage = (host: ImportHost, job: ImportJob, startedAt: number): StepOutcome => {
  const { library } = host;
  const page = library.read((storage) =>
    importRows(storage.db, job.id, ROW, { from: job.cursor, limit: PAGE_ROWS }, plannedItemSchema),
  );
  if (!page.ok) {
    return DONE;
  }
  if (page.value.length === 0) {
    return DONE;
  }
  for (const { idx, value } of page.value) {
    const landed = library.land(importActor(job), { answer: LANDED, opId: undefined }, (scope) => {
      const result = landBookmark(scope, host, value);
      advanceImport(scope.storage.db, job.id, {
        changeSetId: result === "added" ? scope.set().id : undefined,
        counts: result === "added" ? { added: 1 } : { alreadySaved: 1 },
        cursor: idx + 1,
      });
      return result;
    });
    const outcome = landingOutcome(library, job, idx, landed);
    if (outcome !== null) {
      return outcome;
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
