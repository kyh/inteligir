import { describe, expect, it } from "vitest";
import { contentHashBytesHex, contentHashHex, vaultEntrySchema } from "../vault";

describe("the content hash", () => {
  it("is the same convention from a string and from its bytes", async () => {
    // Two entry points into ONE convention: the write CAS hashes the string it
    // is about to send, the index hashes the bytes it just read. They compare
    // against each other's recorded values, so a divergence would read as
    // "every file changed" forever.
    for (const content of ["", "# Note\n", "unicode: café — 日本語 🌱\n", "a\r\nb\n"]) {
      expect(await contentHashBytesHex(new TextEncoder().encode(content))).toBe(
        await contentHashHex(content),
      );
    }
  });
});

describe("a vault tree row", () => {
  it("carries a kind and a path, and refuses anything a content edit moves", () => {
    expect(vaultEntrySchema.parse({ kind: "file", path: "note.md" })).toEqual({
      kind: "file",
      path: "note.md",
    });
    // `.strict()`: a row that grows a per-edit field again fails here rather
    // than quietly re-rendering the workspace on every save.
    expect(vaultEntrySchema.safeParse({ kind: "file", path: "note.md", size: 12 }).success).toBe(
      false,
    );
  });
});
