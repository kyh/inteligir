import type { FieldOp } from "@repo/contract/library/field-ops";
import { describe, expect, it } from "vitest";

import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";
import {
  cellOf,
  clockAt,
  createItem,
  cellIn,
  inCell,
  openTurn,
  landedValue,
  PERSON,
  placed,
  storedItemOf,
  undoFields,
  writeItem,
} from "../test-support/library-cell";
import type { CellActor } from "./cell-actor";
import { runJobs } from "./cell-alarm";
import { FILL_ACTOR } from "./cell-fills";
import type { LibraryEngine } from "./library-engine";
import type { Cell } from "./open-cell";

const DAY = 24 * 60 * 60_000;
const START = Date.UTC(2026, 9, 1);

const count = (state: DurableObjectState, sql: string, ...params: string[]): number =>
  Number(state.storage.sql.exec(sql, ...params).one().n);

// the alarm's run, no job of which fails: one that failed would keep its lease
const run = async (cell: Cell, state: DurableObjectState): Promise<void> => {
  await runJobs(cell);
  expect(count(state, "SELECT count(*) AS n FROM jobs WHERE attempts > 0")).toBe(0);
};

const set = (library: LibraryEngine, actor: CellActor, itemId: string, op: FieldOp): void => {
  landedValue(writeItem(library, actor, { itemId, ops: [op] }));
};

describe("the change-set prune", () => {
  it("drops a set seven days after its turn ended, with its entries, and the set after it still undoes", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt(START);
      const cell = cellIn(state, { clock });
      const { library } = cell;
      const itemId = crypto.randomUUID();
      landedValue(
        createItem(library, PERSON, {
          blocks: placed([paragraph("a", "the first line")]),
          fields: noteFixture(),
          id: itemId,
        }),
      );
      // the agent's renaming, three turns a minute apart
      let title = "A note";
      for (const next of ["typed", "typed more", "typed most"]) {
        clock.now += 60_000;
        const turn = openTurn(cell);
        set(library, turn.actor, itemId, { base: title, field: "title", op: "set", value: next });
        turn.end();
        title = next;
      }
      // three days on a turn describes it, and a day after that one renames it again
      clock.now = START + 3 * DAY;
      const describing = openTurn(cell);
      set(library, describing.actor, itemId, {
        base: null,
        field: "description",
        op: "set",
        value: "the agent's",
      });
      describing.end();
      clock.now = START + 4 * DAY;
      const renaming = openTurn(cell);
      set(library, renaming.actor, itemId, {
        base: title,
        field: "title",
        op: "set",
        value: "typed later",
      });
      renaming.end();
      const entries = (): number =>
        count(state, "SELECT count(*) AS n FROM change_set_items WHERE item_id = ?", itemId);
      expect(count(state, "SELECT count(*) AS n FROM change_sets")).toBe(5);
      expect(entries()).toBe(5);
      clock.now = START + 8 * DAY;
      await run(cell, state);
      // the first three turns' sets went; the describing and the last renaming stay
      expect(
        state.storage.sql
          .exec("SELECT thread_id FROM change_sets ORDER BY opened_at")
          .toArray()
          .map((row) => row.thread_id),
      ).toStrictEqual([describing.actor.threadId, renaming.actor.threadId]);
      expect(entries()).toBe(2);
      const answer = landedValue(undoFields(library, [describing.setId()]));
      expect(answer.reverted).toStrictEqual([itemId]);
      expect(storedItemOf(library, itemId)).toMatchObject({
        fields: { description: null, title: "typed later" },
      });
    });
  });

  it("keeps a set whose turn is still open, however old", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt(START);
      const cell = cellIn(state, { clock });
      const { library } = cell;
      const [ended, open] = [openTurn(cell), openTurn(cell)];
      for (const turn of [ended, open]) {
        landedValue(
          createItem(library, turn.actor, {
            blocks: placed([paragraph("a", "the first line")]),
            fields: noteFixture(),
            id: crypto.randomUUID(),
          }),
        );
      }
      ended.end();
      clock.now = START + 30 * DAY;
      await run(cell, state);
      expect(
        state.storage.sql.exec("SELECT thread_id, sealed_at FROM change_sets").toArray(),
      ).toStrictEqual([{ sealed_at: null, thread_id: open.actor.threadId }]);
      expect(count(state, "SELECT count(*) AS n FROM change_set_items")).toBe(1);
    });
  });

  it("drops a page a run, and runs again at once while more wait", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt(START);
      const cell = cellIn(state, { clock });
      const { alarmAt, library } = cell;
      const turn = openTurn(cell);
      for (let index = 0; index < 101; index += 1) {
        landedValue(
          createItem(library, turn.actor, {
            blocks: placed([paragraph("a", String(index))]),
            fields: noteFixture(),
            id: crypto.randomUUID(),
          }),
        );
      }
      turn.end();
      clock.now = START + 8 * DAY;
      await run(cell, state);
      expect(count(state, "SELECT count(*) AS n FROM change_set_items")).toBe(1);
      expect(count(state, "SELECT count(*) AS n FROM change_sets")).toBe(1);
      expect(alarmAt()).toBe(clock.now + 1000);
      clock.now += 1000;
      await run(cell, state);
      expect(count(state, "SELECT count(*) AS n FROM change_sets")).toBe(0);
    });
  });

  it("forgets an op's answer after 30 days", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt(START);
      const cell = cellIn(state, { clock });
      const { library } = cell;
      const opId = crypto.randomUUID();
      landedValue(
        createItem(library, FILL_ACTOR, {
          blocks: placed([paragraph("a", "a line")]),
          fields: noteFixture(),
          id: crypto.randomUUID(),
          opId,
        }),
      );
      const answers = (): number =>
        count(state, "SELECT count(*) AS n FROM applied_ops WHERE op_id = ?", opId);
      clock.now = START + 29 * DAY;
      await run(cell, state);
      expect(answers()).toBe(1);
      clock.now = START + 31 * DAY;
      await run(cell, state);
      expect(answers()).toBe(0);
    });
  });
});
