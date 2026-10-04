import { describe, expect, it } from "vitest";
import { encodeThreadListCursor, listThreadsQuerySchema } from "../threads-schema";

describe("the thread listing's cursor", () => {
  it.each([
    { archived: false, id: "thr_2345abcdef", updatedAt: 1_700_000_000_000 },
    { archived: true, id: "thr.with.dots", updatedAt: 0 },
  ])("reads back the position it was minted from ($id)", (position) => {
    const parsed = listThreadsQuerySchema.parse({ cursor: encodeThreadListCursor(position) });
    expect(parsed.cursor).toEqual(position);
  });

  it.each(["", "x.1.thr_a", "l.1", "l..thr_a", "l.99999999999999999.thr_a", "l.1."])(
    "refuses %j, which no listing answered",
    (cursor) => {
      expect(listThreadsQuerySchema.safeParse({ cursor }).success).toBe(false);
    },
  );
});
