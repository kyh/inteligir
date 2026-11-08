import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  blocksOf,
  cellOf,
  clockAt,
  createItem,
  engineIn,
  hashOf,
  inCell,
  landedValue,
  noteFields,
  paragraph,
  person,
  placed,
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

const put = (
  library: LibraryEngine,
  actor: CellActor,
  itemId: string,
  from: LibraryBlock,
  to: LibraryBlock,
): void => {
  landedValue(
    library.write(actor, { itemId, ops: [{ baseHash: hashOf(from), block: to, op: "put" }] }),
  );
};

describe("the change-set prune", () => {
  it("drops a set seven days after it closed, with what only it named, and the set after it still undoes", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt(START);
      const library = engineIn(state, clock);
      const itemId = crypto.randomUUID();
      const [first, second] = [paragraph("a", "the first line"), paragraph("b", "the second")];
      landedValue(
        createItem(library, FILL_ACTOR, {
          blocks: placed([first, second]),
          fields: noteFields(),
          id: itemId,
        }),
      );
      // the person's typing, three sets a minute apart, each a version of the first line
      let line = first;
      for (const text of ["typed", "typed more", "typed most"]) {
        clock.now += 60_000;
        const next = paragraph("a", text);
        put(library, person(), itemId, line, next);
        line = next;
        clock.now += 60_000;
        library.runDueJobs(failOn);
      }
      // three days on the agent rewrites the second line, and a day after that the person the first
      clock.now = START + 3 * DAY;
      const agents = paragraph("b", "the agent's");
      put(library, agent, itemId, second, agents);
      library.closeChangeSet(agentSet(state));
      clock.now = START + 4 * DAY;
      const later = paragraph("a", "typed later");
      put(library, person(), itemId, line, later);
      clock.now += 60_000;
      library.runDueJobs(failOn);
      const versions = (): number =>
        count(state, "SELECT count(*) AS n FROM block_versions WHERE item_id = ?", itemId);
      expect(count(state, "SELECT count(*) AS n FROM change_sets")).toBe(6);
      // every line a write replaced
      expect(versions()).toBe(5);
      clock.now = START + 8 * DAY;
      library.runDueJobs(failOn);
      // the reading's and the first three of the person's went; the agent's and the last stay
      expect(
        state.storage.sql
          .exec("SELECT actor FROM change_sets ORDER BY opened_at")
          .toArray()
          .map((row) => row.actor),
      ).toStrictEqual(["agent", "person"]);
      // what only the dropped sets named went: of the replaced lines, the two the agent's set
      // still names (the first line as it found it, and the second line before it)
      expect(versions()).toBe(2);
      const answer = landedValue(library.undo(person(), { changeSetIds: [agentSet(state)] }));
      expect(answer.reverted).toStrictEqual([itemId]);
      expect(blocksOf(library, itemId)).toStrictEqual([later, second]);
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
          fields: noteFields(),
          id: itemId,
        }),
      );
      put(library, agent, itemId, line, paragraph("a", "the agent's"));
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
            fields: noteFields(),
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
          fields: noteFields(),
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
