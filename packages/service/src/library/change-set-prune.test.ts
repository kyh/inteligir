import type { FieldOp } from "@repo/contract/library/field-ops";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";
import {
  cellOf,
  clockAt,
  createItem,
  engineIn,
  inCell,
  landedValue,
  person,
  placed,
  storedItemOf,
  undoFields,
} from "../test-support/library-cell";
import type { CellActor } from "./cell-actor";
import { FILL_ACTOR } from "./cell-fills";
import type { LibraryEngine } from "./library-engine";

const DAY = 24 * 60 * 60_000;
const START = Date.UTC(2026, 9, 1);

const agent: CellActor = { kind: "agent", label: "Agent", threadId: crypto.randomUUID(), turn: 1 };

const failOn = (job: { readonly kind: string }, cause: unknown): never => {
  throw new Error(`the ${job.kind} job failed`, { cause });
};

const count = (state: DurableObjectState, sql: string, ...params: string[]): number =>
  Number(state.storage.sql.exec(sql, ...params).one().n);

const agentSet = (state: DurableObjectState): string =>
  z
    .string()
    .parse(state.storage.sql.exec("SELECT id FROM change_sets WHERE actor = 'agent'").one().id);

const set = (library: LibraryEngine, actor: CellActor, itemId: string, op: FieldOp): void => {
  landedValue(library.write(actor, { itemId, ops: [op] }));
};

describe("the change-set prune", () => {
  it("drops a set seven days after it closed, with what only it named, and the set after it still undoes", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt(START);
      const library = engineIn(state, clock);
      const itemId = crypto.randomUUID();
      landedValue(
        createItem(library, FILL_ACTOR, {
          blocks: placed([paragraph("a", "the first line")]),
          fields: noteFixture(),
          id: itemId,
        }),
      );
      // the person's renaming, three sets a minute apart
      let title = "A note";
      for (const next of ["typed", "typed more", "typed most"]) {
        clock.now += 60_000;
        set(library, person(), itemId, { base: title, field: "title", op: "set", value: next });
        title = next;
        clock.now += 60_000;
        library.runDueJobs(failOn);
      }
      // three days on the agent describes it, and a day after that the person renames it again
      clock.now = START + 3 * DAY;
      set(library, agent, itemId, {
        base: null,
        field: "description",
        op: "set",
        value: "the agent's",
      });
      library.closeChangeSet(agentSet(state));
      clock.now = START + 4 * DAY;
      set(library, person(), itemId, {
        base: title,
        field: "title",
        op: "set",
        value: "typed later",
      });
      clock.now += 60_000;
      library.runDueJobs(failOn);
      const parts = (): number =>
        count(state, "SELECT count(*) AS n FROM snapshot_parts WHERE item_id = ?", itemId);
      expect(count(state, "SELECT count(*) AS n FROM change_sets")).toBe(6);
      // every state of the fields a set began or left
      expect(parts()).toBe(6);
      clock.now = START + 8 * DAY;
      library.runDueJobs(failOn);
      // the reading's and the first three of the person's went; the agent's and the last stay
      expect(
        state.storage.sql
          .exec("SELECT actor FROM change_sets ORDER BY opened_at")
          .toArray()
          .map((row) => row.actor),
      ).toStrictEqual(["agent", "person"]);
      // what only the dropped sets named went: the fields the agent found, left, and the person's
      // last renaming left
      expect(parts()).toBe(3);
      const answer = landedValue(undoFields(library, person(), [agentSet(state)]));
      expect(answer.reverted).toStrictEqual([itemId]);
      expect(storedItemOf(library, itemId)).toMatchObject({
        fields: { description: null, title: "typed later" },
      });
    });
  });

  it("keeps a set still open, however old", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt(START);
      const library = engineIn(state, clock);
      const itemId = crypto.randomUUID();
      const line = paragraph("a", "the first line");
      landedValue(
        createItem(library, FILL_ACTOR, {
          blocks: placed([line]),
          fields: noteFixture(),
          id: itemId,
        }),
      );
      set(library, agent, itemId, {
        base: "A note",
        field: "title",
        op: "set",
        value: "the agent's",
      });
      clock.now = START + 30 * DAY;
      library.runDueJobs(failOn);
      expect(
        count(state, "SELECT count(*) AS n FROM change_set_items WHERE item_id = ?", itemId),
      ).toBe(1);
      expect(
        state.storage.sql
          .exec("SELECT sealed_at FROM change_sets")
          .toArray()
          .map((row) => row.sealed_at),
      ).toStrictEqual([null]);
    });
  });

  it("drops a page a run, and runs again at once while more wait", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt(START);
      const library = engineIn(state, clock);
      for (let index = 0; index < 101; index += 1) {
        landedValue(
          createItem(library, FILL_ACTOR, {
            blocks: placed([paragraph("a", String(index))]),
            fields: noteFixture(),
            id: crypto.randomUUID(),
          }),
        );
      }
      clock.now = START + 8 * DAY;
      library.runDueJobs(failOn);
      expect(count(state, "SELECT count(*) AS n FROM change_sets")).toBe(1);
      expect(library.nextJobAt()).toBe(clock.now + 1000);
      clock.now += 1000;
      library.runDueJobs(failOn);
      expect(count(state, "SELECT count(*) AS n FROM change_sets")).toBe(0);
    });
  });

  it("forgets an op's answer after 30 days", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt(START);
      const library = engineIn(state, clock);
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
