// the fills a running Mac has queued, read from its own database: a row per stub it will read. A
// scenario reads it to see which device fills a link, since a stub another device saved holds no
// row on any Mac. Read-only, beside the server's own connection, as WAL allows.

import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { AppInstance } from "./instance";

const rowSchema = z.object({ item_id: z.string(), path: z.string() });

export const macPendingFills = (mac: AppInstance): { itemId: string; path: string }[] => {
  const db = new DatabaseSync(path.join(mac.dataDir, "inteligir.db"), { readOnly: true });
  try {
    return db
      .prepare("SELECT item_id, path FROM pending_fills ORDER BY path")
      .all()
      .map((row) => {
        const parsed = rowSchema.parse(row);
        return { itemId: parsed.item_id, path: parsed.path };
      });
  } finally {
    db.close();
  }
};
