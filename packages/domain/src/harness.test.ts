import { describe, expect, it } from "vitest";
import { HARNESS_IDS, parseHarnessId } from "./harness";

describe("parseHarnessId", () => {
  it.each(HARNESS_IDS)("knows %s", (id) => {
    expect(parseHarnessId(id)).toEqual({ id, kind: "known" });
  });

  it.each(["gemini", "constructor", "toString", "__proto__", "hasOwnProperty"])(
    "keeps %s, which this build ships no harness for, as unknown",
    (id) => {
      expect(parseHarnessId(id)).toEqual({ id, kind: "unknown" });
    },
  );
});
