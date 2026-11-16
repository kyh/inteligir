import type { LibraryItemFields } from "@repo/contract/library/library-item";
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
  setFields,
  storedItemOf,
  undoFields,
} from "../test-support/library-cell";
import type { CellActor } from "./cell-actor";
import { FILL_ACTOR } from "./cell-fills";
import type { LibraryEngine } from "./library-engine";

const DAY = 24 * 60 * 60_000;
const START = Date.UTC(2026, 9, 1);

const failOn = (job: { readonly kind: string }, cause: unknown): never => {
  throw new Error(`the ${job.kind} job failed`, { cause });
};

const count = (state: DurableObjectState, sql: string, ...params: string[]): number =>
  Number(state.storage.sql.exec(sql, ...params).one().n);

const set = (
  library: LibraryEngine,
  actor: CellActor,
  itemId: string,
  fields: Partial<LibraryItemFields>,
): void => {
  landedValue(setFields(library, actor, itemId, fields));
};

describe("the change-set prune", () => {
  it("drops a set seven days after its turn ended, with its entries, and the set after it still undoes", async () => {
    await inCell(cellOf(), (state) => {
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
      for (const title of ["typed", "typed more", "typed most"]) {
        clock.now += 60_000;
        const turn = openTurn(cell);
        set(library, turn.actor, itemId, { title });
        turn.end();
      }
      // three days on a turn describes it, and a day after that one renames it again
      clock.now = START + 3 * DAY;
      const describing = openTurn(cell);
      set(library, describing.actor, itemId, { description: "the agent's" });
      describing.end();
      clock.now = START + 4 * DAY;
      const renaming = openTurn(cell);
      set(library, renaming.actor, itemId, { title: "typed later" });
      renaming.end();
      const entries = (): number =>
        count(state, "SELECT count(*) AS n FROM change_set_items WHERE item_id = ?", itemId);
      expect(count(state, "SELECT count(*) AS n FROM change_sets")).toBe(5);
      expect(entries()).toBe(5);
      clock.now = START + 8 * DAY;
      library.runDueJobs(failOn);
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
    await inCell(cellOf(), (state) => {
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
      library.runDueJobs(failOn);
      expect(
        state.storage.sql.exec("SELECT thread_id, sealed_at FROM change_sets").toArray(),
      ).toStrictEqual([{ sealed_at: null, thread_id: open.actor.threadId }]);
      expect(count(state, "SELECT count(*) AS n FROM change_set_items")).toBe(1);
    });
  });

  it("drops a page a run, and runs again at once while more wait", async () => {
    await inCell(cellOf(), (state) => {
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
      library.runDueJobs(failOn);
      expect(count(state, "SELECT count(*) AS n FROM change_set_items")).toBe(1);
      expect(count(state, "SELECT count(*) AS n FROM change_sets")).toBe(1);
      expect(alarmAt()).toBe(clock.now + 1000);
      clock.now += 1000;
      library.runDueJobs(failOn);
      expect(count(state, "SELECT count(*) AS n FROM change_sets")).toBe(0);
    });
  });

  it("forgets an op's answer after 30 days", async () => {
    await inCell(cellOf(), (state) => {
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
      library.runDueJobs(failOn);
      expect(answers()).toBe(1);
      clock.now = START + 31 * DAY;
      library.runDueJobs(failOn);
      expect(answers()).toBe(0);
    });
  });
});
