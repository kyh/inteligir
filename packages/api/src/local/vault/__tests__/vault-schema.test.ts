import { describe, expect, it } from "vitest";
import {
  contentHashBytesHex,
  contentHashHex,
  vaultEntrySchema,
  vaultHistoryRequestSchema,
  vaultRevisionSchema,
  vaultRevisionShaSchema,
} from "../vault-schema";

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

describe("a revision's object name", () => {
  it("takes an abbreviated or full hex name, in either hash algorithm", () => {
    for (const sha of ["0f1e2d3", "a".repeat(40), "b".repeat(64)]) {
      expect(vaultRevisionShaSchema.safeParse(sha).success).toBe(true);
    }
  });

  it("refuses everything git's revision grammar could otherwise smuggle in", () => {
    // The value lands in a `<sha>:<path>` argv slot. `execFile` reaches no
    // shell, so this is not about quoting — it is about git's OWN language.
    for (const sha of ["HEAD", "main@{1}", "--upload-pack=x", "abc", "A".repeat(40), ""]) {
      expect(vaultRevisionShaSchema.safeParse(sha).success).toBe(false);
    }
  });
});

describe("a revision row", () => {
  it("carries the path AT that revision, and the rename only when there was one", () => {
    const row = {
      sha: "a".repeat(40),
      authoredAt: "2026-01-01T00:00:00+00:00",
      authorName: "inteligir",
      authorEmail: "vault@inteligir.local",
      subject: "vault: update Note.md",
      path: "Note.md",
    };
    expect(vaultRevisionSchema.parse(row)).toEqual(row);
    expect(vaultRevisionSchema.parse({ ...row, renamedFrom: "Old.md" }).renamedFrom).toBe("Old.md");
    expect(vaultRevisionSchema.safeParse({ ...row, hash: "x" }).success).toBe(false);
  });
});

describe("a history request", () => {
  it("normalizes its path through the one vault grammar and bounds the page", () => {
    expect(vaultHistoryRequestSchema.parse({ path: "notes//a.md" }).path).toBe("notes/a.md");
    expect(vaultHistoryRequestSchema.safeParse({ path: "./notes/a.md" }).success).toBe(false);
    expect(vaultHistoryRequestSchema.safeParse({ path: "../escape.md" }).success).toBe(false);
    expect(vaultHistoryRequestSchema.safeParse({ path: "a.md", limit: 0 }).success).toBe(false);
    expect(vaultHistoryRequestSchema.safeParse({ path: "a.md", limit: 10_000 }).success).toBe(
      false,
    );
    expect(vaultHistoryRequestSchema.safeParse({ path: "a.md", skip: -1 }).success).toBe(false);
  });
});
