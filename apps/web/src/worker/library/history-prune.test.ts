import { describe, expect, it } from "vitest";

import {
  cellOf,
  clockAt,
  engineIn,
  hashOf,
  inCell,
  landedValue,
  noteFields,
  paragraph,
  person,
  placed,
  SYSTEM,
} from "../test-support/library-cell";
import type { CellActor } from "./cell-actor";
import { revisionsToDrop } from "./history-prune";

const DAY = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 9, 1);

describe("which revisions history keeps", () => {
  it("keeps the newest 100 whatever their age", () => {
    const revisions = Array.from({ length: 100 }, (_, index) => ({
      at: NOW - 400 * DAY + index,
      rev: index + 1,
    }));
    expect(revisionsToDrop(revisions, NOW)).toEqual([]);
  });

  it("keeps everything of the last 30 days past the newest 100", () => {
    const revisions = Array.from({ length: 150 }, (_, index) => ({
      at: NOW - DAY + index,
      rev: index + 1,
    }));
    expect(revisionsToDrop(revisions, NOW)).toEqual([]);
  });

  it("keeps a day's last revision past the newest 100 and 30 days", () => {
    // ten older revisions a day for five days, two months back, then the newest 100 today
    const old = Array.from({ length: 50 }, (_, index) => ({
      at: NOW - 60 * DAY + Math.floor(index / 10) * DAY + (index % 10),
      rev: index + 1,
    }));
    const recent = Array.from({ length: 100 }, (_, index) => ({
      at: NOW - index,
      rev: 151 - index,
    }));
    const dropped = revisionsToDrop([...old, ...recent], NOW);
    expect(dropped).toHaveLength(45);
    expect(dropped).not.toEqual(expect.arrayContaining([10, 20, 30, 40, 50]));
  });
});

describe("the prune job", () => {
  it("drops what history no longer keeps, with the versions and parts only it named", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt(NOW - 90 * DAY);
      const library = engineIn(state, clock);
      const itemId = crypto.randomUUID();
      let block = paragraph("a", "version 0");
      landedValue(
        library.create(SYSTEM, { blocks: placed([block]), fields: noteFields(), id: itemId }),
      );
      // a revision a write (the library's own writes seal as they land): 130 of them, the first
      // 30 two months back, a few hours apart, then one a minute today
      for (let index = 1; index <= 130; index += 1) {
        clock.now = index <= 30 ? NOW - 60 * DAY + index * 3_600_000 : NOW - (131 - index) * 60_000;
        const next = paragraph("a", `version ${String(index)}`);
        landedValue(
          library.write(SYSTEM, {
            itemId,
            ops: [{ baseHash: hashOf(block), block: next, op: "put" }],
          }),
        );
        block = next;
      }
      const count = (sql: string): number => Number(state.storage.sql.exec(sql, itemId).one()["n"]);
      expect(count("SELECT count(*) AS n FROM revisions WHERE item_id = ?")).toBe(131);
      clock.now = NOW;
      // the job waits a day after the first sealed set
      expect(library.nextJobAt()).toBeLessThanOrEqual(NOW);
      library.runDueJobs((job, cause) => {
        throw new Error(`the ${job.kind} job failed`, { cause });
      });
      // the newest 100, and of the 31 older ones (all past 30 days) the last of each day: the
      // create's day and the 30 revisions' two days
      expect(count("SELECT count(*) AS n FROM revisions WHERE item_id = ?")).toBe(103);
      // what a kept revision or a kept set's before still names, and no other: the 103 revisions
      // name 103 versions, the newest of them the block as it stands; and the two sets kept after a
      // gap (revisions 24 and 31) still name the version before them, which an undo brings back
      expect(count("SELECT count(*) AS n FROM block_versions WHERE item_id = ?")).toBe(104);
      const kept = state.storage.sql
        .exec("SELECT max(rev) AS n FROM revisions WHERE item_id = ?", itemId)
        .one()["n"];
      expect(kept).toBe(131);
      const revision = landedValue(library.revision(itemId, 131));
      expect(revision?.blocks.map((stored) => stored.block)).toEqual([block]);
      const firstKept = state.storage.sql
        .exec("SELECT min(rev) AS n FROM revisions WHERE item_id = ?", itemId)
        .one()["n"];
      expect(landedValue(library.revision(itemId, Number(firstKept)))?.blocks).toHaveLength(1);
    });
  });

  it("keeps a set's entry for an item while one of its revisions of it stays", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt(NOW - 60 * DAY);
      const library = engineIn(state, clock);
      const itemId = crypto.randomUUID();
      let block = paragraph("a", "version 0");
      const put = (actor: CellActor, text: string): void => {
        const next = paragraph("a", text);
        landedValue(
          library.write(actor, {
            itemId,
            ops: [{ baseHash: hashOf(block), block: next, op: "put" }],
          }),
        );
        block = next;
      };
      landedValue(
        library.create(SYSTEM, { blocks: placed([block]), fields: noteFields(), id: itemId }),
      );
      // two months back the person's set wrote, the library wrote over it, and the person took
      // the item back: the person's set holds two revisions of it, the day's last among them
      clock.now += 1000;
      put(person(), "typed");
      clock.now += 1000;
      put(SYSTEM, "the library's");
      clock.now += 1000;
      put(person(), "typed again");
      clock.now += 60_000;
      library.runDueJobs(() => {});
      // then the newest 100, today
      for (let index = 1; index <= 100; index += 1) {
        clock.now = NOW - (101 - index) * 60_000;
        put(SYSTEM, `today ${String(index)}`);
      }
      clock.now = NOW;
      library.runDueJobs((job, cause) => {
        throw new Error(`the ${job.kind} job failed`, { cause });
      });
      const entries = state.storage.sql
        .exec(
          `SELECT change_sets.actor AS actor, count(revisions.rev) AS revisions
           FROM change_set_items JOIN change_sets ON change_sets.id = change_set_items.change_set_id
           LEFT JOIN revisions ON revisions.change_set_id = change_set_items.change_set_id
             AND revisions.item_id = change_set_items.item_id
           WHERE change_set_items.item_id = ? AND change_sets.opened_at < ?
           GROUP BY change_set_items.change_set_id`,
          itemId,
          NOW - DAY,
        )
        .toArray();
      // the person's set keeps its entry by its later revision; the library's two sets of that
      // day lost theirs with their only revisions
      expect(entries).toEqual([{ actor: "person", revisions: 1 }]);
    });
  });
});
