import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { links } from "@repo/db/cell/schema";
import { cellOf, inCell } from "../test-support/library-cell";
import { cellDbOf, insertChunks, listChunks } from "./cell-db";

describe(insertChunks, () => {
  it("cuts a multi-row insert by the table's width into statements a Durable Object takes", async () => {
    await inCell(cellOf(), (state) => {
      const db = cellDbOf(state.storage);
      const rows = Array.from({ length: 250 }, (_, index) => ({
        sourceId: "source",
        targetId: `target-${String(index)}`,
        targetKey: null,
      }));
      // three columns a row, so 33 rows bind 99 parameters
      const chunks = insertChunks(links, rows);
      expect(chunks.map((chunk) => chunk.length)).toStrictEqual([33, 33, 33, 33, 33, 33, 33, 19]);
      expect(chunks.flat()).toStrictEqual(rows);
      expect(() => db.insert(links).values(rows).run()).toThrow(
        expect.objectContaining({
          cause: expect.objectContaining({
            message: expect.stringMatching(/too many SQL variables/u),
          }),
        }),
      );
      for (const chunk of chunks) {
        db.insert(links).values(chunk).run();
      }
      expect(db.select({ n: count() }).from(links).get()).toStrictEqual({ n: 250 });
    });
  });
});

describe(listChunks, () => {
  it("cuts an IN list so each statement binds it beside its own parameters", () => {
    const values = Array.from({ length: 250 }, (_, index) => index);
    expect(listChunks(values, 2).map((chunk) => chunk.length)).toStrictEqual([98, 98, 54]);
    expect(listChunks(values).map((chunk) => chunk.length)).toStrictEqual([100, 100, 50]);
  });
});
