import type { libraryChangeSchema } from "@repo/contract/cloud/library/library-wire";
import { readItem } from "@repo/notes/library/library-queries";
import { ensureLibrarySchema } from "@repo/notes/library/library-schema";
import { runPlanAsync } from "@repo/notes/library/library-sql";
import { mulberry32, pick } from "@repo/notes/test-support/seeded-random";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { openMemorySql } from "./memory-sql";
import { applyChange, readWants, touchedNothing } from "./replica-rows";

type LibraryChange = z.infer<typeof libraryChangeSchema>;
type ItemRow = Extract<LibraryChange, { kind: "item" }>["row"];

const IDS = [
  "01900000-0000-7000-8000-000000000001",
  "01900000-0000-7000-8000-000000000002",
  "01900000-0000-7000-8000-000000000003",
  "01900000-0000-7000-8000-000000000004",
];

const FIELDS = {
  aliases: [],
  author: null,
  copySha: null,
  coverSha: null,
  deletedAt: null,
  description: null,
  fetchError: null,
  fetchState: "pending" as const,
  fetchedAt: null,
  folderId: null,
  kind: "link" as const,
  lang: null,
  originalName: null,
  originalSha: null,
  pinnedAt: null,
  properties: {},
  published: null,
  savedAt: 1_700_000_000_000,
  site: null,
  tags: [],
  title: "",
  url: null,
};

// an item's row at one sequence: live under a title, or emptied for good
const itemChange = (id: string, seq: number, purged: boolean, url: string): LibraryChange => ({
  id,
  kind: "item",
  row: purged
    ? { deletedAt: 1_700_000_000_000, id, kind: "purged", seq, updatedAt: seq }
    : {
        card: { outline: [], preview: "", title: `title ${String(seq)}`, words: 0 },
        fields: { ...FIELDS, title: `title ${String(seq)}`, url },
        id,
        kind: "live",
        seq,
        updatedAt: seq,
      },
  seq,
});

// the log's rows as a cell would have sent them over time: each id's row at each sequence it
// moved to, one address passed between items, held by one live item at a time, and an emptied
// item never live again
const historyOf = (rand: () => number): LibraryChange[] => {
  const purged = new Set<string>();
  const changes: LibraryChange[] = [];
  let holder: string | null = null;
  let seq = 0;
  for (let step = 0; step < 12; step += 1) {
    const id = pick(rand, IDS);
    if (purged.has(id)) {
      continue;
    }
    const empty = rand() < 0.15;
    const shared = !empty && rand() < 0.5;
    if (shared && holder !== null && holder !== id) {
      // the address leaves its holder before another item takes it
      seq += 1;
      changes.push(itemChange(holder, seq, false, `https://example.com/${holder}`));
    }
    seq += 1;
    changes.push(itemChange(id, seq, empty, `https://example.com/${shared ? "shared" : id}`));
    if (shared) {
      holder = id;
    } else if (holder === id) {
      holder = null;
    }
    if (empty) {
      purged.add(id);
    }
  }
  return changes;
};

const shuffled = <T>(rand: () => number, items: readonly T[]): T[] => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rand() * (index + 1));
    const here = out[index];
    const there = out[other];
    if (here !== undefined && there !== undefined) {
      out[index] = there;
      out[other] = here;
    }
  }
  return out;
};

describe("a pulled row", () => {
  it(
    "lands only over an older one, whatever order its pages arrive in, over seeded runs",
    { timeout: 30_000 },
    async () => {
      for (let seed = 1; seed <= 60; seed += 1) {
        const rand = mulberry32(seed);
        const history = historyOf(rand);
        const sql = await openMemorySql();
        await sql.exclusive(async (tx) => {
          await runPlanAsync(tx, ensureLibrarySchema("replica"));
        });
        const order = shuffled(rand, history);
        while (order.length > 0) {
          const page = order.splice(0, 1 + Math.floor(rand() * 3));
          await sql.exclusive(async (tx) => {
            for (const change of page) {
              await runPlanAsync(tx, applyChange(change, touchedNothing()));
            }
          });
        }
        const newest = new Map<string, ItemRow>();
        for (const change of history) {
          if (change.kind === "item") {
            newest.set(change.id, change.row);
          }
        }
        for (const id of IDS) {
          const held = await runPlanAsync(sql, readItem(id));
          const want = newest.get(id) ?? null;
          expect(
            held === null ? null : { kind: held.kind, seq: held.seq },
            `seed ${String(seed)}, ${id}`,
          ).toEqual(want === null ? null : { kind: want.kind, seq: want.seq });
        }
        const wants = await runPlanAsync(sql, readWants());
        const live = [...newest.values()].flatMap((row) =>
          row?.kind === "live" ? [{ itemId: row.id, seq: row.seq }] : [],
        );
        expect(
          wants.toSorted((a, b) => (a.itemId < b.itemId ? -1 : 1)),
          `seed ${String(seed)}`,
        ).toEqual(live.toSorted((a, b) => (a.itemId < b.itemId ? -1 : 1)));
        sql.close();
      }
    },
  );
});
