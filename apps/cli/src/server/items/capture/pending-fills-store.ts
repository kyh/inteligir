// the stubs this Mac means to fill, one row each in the vault's own inteligir.db (`pending_fills`),
// written per transition with one statement: an 8,500-item import is 8,500 inserts and later one
// update or delete each, never a rewrite of the rows before it. The rows are read once, at boot;
// the capture holds them in memory from then on.

import { randomBytes } from "node:crypto";

import type { DbConnection } from "@repo/db/connection";
import { z } from "zod";

export type FillOrigin = "own" | "phone" | "foreign";

export interface PendingFill {
  itemId: string;
  path: string;
  url: string;
  origin: FillOrigin;
  keepCopy: boolean;
  coverHint: string | null;
  attempts: number;
  // epoch ms
  firstSeenAt: number;
  notBefore: number;
}

export interface PendingFillsStore {
  all: () => PendingFill[];
  // a row for an id already held is left as it is
  insert: (row: PendingFill) => void;
  setPath: (itemId: string, path: string) => void;
  setKeepCopy: (itemId: string) => void;
  reschedule: (itemId: string, attempts: number, notBefore: number) => void;
  remove: (itemId: string) => void;
  // the 16 random bytes that shuffle when this Mac fills a phone's stub, minted on first use
  shuffleSeed: () => string;
}

const rowSchema = z.object({
  attempts: z.number().int(),
  cover_hint: z.string().nullable(),
  first_seen_at: z.number(),
  item_id: z.string(),
  keep_copy: z.number().int(),
  not_before: z.number(),
  origin: z.enum(["own", "phone", "foreign"]),
  path: z.string(),
  url: z.string(),
});

const SHUFFLE_SEED_KEY = "fill-shuffle-seed";

export const createPendingFillsStore = (db: DbConnection): PendingFillsStore => {
  const sqlite = db.$client;
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO pending_fills
       (item_id, path, url, origin, keep_copy, cover_hint, attempts, first_seen_at, not_before)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const setPath = sqlite.prepare("UPDATE pending_fills SET path = ? WHERE item_id = ?");
  const setKeepCopy = sqlite.prepare("UPDATE pending_fills SET keep_copy = 1 WHERE item_id = ?");
  const reschedule = sqlite.prepare(
    "UPDATE pending_fills SET attempts = ?, not_before = ? WHERE item_id = ?",
  );
  const remove = sqlite.prepare("DELETE FROM pending_fills WHERE item_id = ?");
  const all = sqlite.prepare("SELECT * FROM pending_fills ORDER BY not_before, first_seen_at");
  const readSeed = sqlite.prepare("SELECT value FROM meta WHERE key = ?");
  const writeSeed = sqlite.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)");

  return {
    all: () =>
      all.all().flatMap((raw) => {
        const row = rowSchema.safeParse(raw);
        if (!row.success) {
          return [];
        }
        return [
          {
            attempts: row.data.attempts,
            coverHint: row.data.cover_hint,
            firstSeenAt: row.data.first_seen_at,
            itemId: row.data.item_id,
            keepCopy: row.data.keep_copy !== 0,
            notBefore: row.data.not_before,
            origin: row.data.origin,
            path: row.data.path,
            url: row.data.url,
          },
        ];
      }),

    insert: (row) => {
      insert.run(
        row.itemId,
        row.path,
        row.url,
        row.origin,
        row.keepCopy ? 1 : 0,
        row.coverHint,
        row.attempts,
        row.firstSeenAt,
        row.notBefore,
      );
    },

    remove: (itemId) => {
      remove.run(itemId);
    },

    reschedule: (itemId, attempts, notBefore) => {
      reschedule.run(attempts, notBefore, itemId);
    },

    setKeepCopy: (itemId) => {
      setKeepCopy.run(itemId);
    },

    setPath: (itemId, path) => {
      setPath.run(path, itemId);
    },

    shuffleSeed: () => {
      const read = z.object({ value: z.string() }).safeParse(readSeed.get(SHUFFLE_SEED_KEY));
      if (read.success) {
        return read.data.value;
      }
      writeSeed.run(SHUFFLE_SEED_KEY, randomBytes(16).toString("hex"));
      const minted = z.object({ value: z.string() }).parse(readSeed.get(SHUFFLE_SEED_KEY));
      return minted.value;
    },
  };
};
