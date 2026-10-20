import { describe, expect, it } from "vitest";
import { vaultOpSchema } from "./outbox-ops";

const OID = "a".repeat(40);

describe("an outbox row's op", () => {
  it("fails to parse when it lacks a field every write sets", () => {
    const rename = {
      baseContent: "# a\n",
      baseOid: OID,
      content: null,
      from: "a.md",
      op: "rename",
      rewrites: [],
      to: "b.md",
    };
    expect(vaultOpSchema.safeParse(rename).success).toBe(true);
    expect(vaultOpSchema.safeParse({ ...rename, content: undefined }).success).toBe(false);
    expect(vaultOpSchema.safeParse({ ...rename, rewrites: undefined }).success).toBe(false);

    const remove = { baseOid: OID, op: "remove", path: "a.md", alongside: [] };
    expect(vaultOpSchema.safeParse(remove).success).toBe(true);
    expect(vaultOpSchema.safeParse({ ...remove, alongside: undefined }).success).toBe(false);
  });
});
