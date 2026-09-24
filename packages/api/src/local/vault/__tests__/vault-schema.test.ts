import { describe, expect, it } from "vitest";
import { VAULT_ASSET_MAX_BYTES as CLOUD_ASSET_MAX_BYTES } from "../../../cloud/vault/vault-schema";
import {
  contentHashBytesHex,
  contentHashHex,
  VAULT_ASSET_MAX_BYTES,
  vaultAssetWriteRequestSchema,
  vaultEntrySchema,
  vaultHistoryRequestSchema,
  vaultRevisionSchema,
  vaultRevisionShaSchema,
} from "../vault-schema";

describe("the content hash", () => {
  it("is the same convention from a string and from its bytes", async () => {
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
    for (const sha of ["HEAD", "main@{1}", "--upload-pack=x", "abc", "A".repeat(40), ""]) {
      expect(vaultRevisionShaSchema.safeParse(sha).success).toBe(false);
    }
  });
});

describe("a revision row", () => {
  it("carries the path AT that revision, and the rename only when there was one", () => {
    const row = {
      authorEmail: "vault@inteligir.local",
      authorName: "inteligir",
      authoredAt: "2026-01-01T00:00:00+00:00",
      path: "Note.md",
      sha: "a".repeat(40),
      subject: "vault: update Note.md",
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
    expect(vaultHistoryRequestSchema.safeParse({ limit: 0, path: "a.md" }).success).toBe(false);
    expect(vaultHistoryRequestSchema.safeParse({ limit: 10_000, path: "a.md" }).success).toBe(
      false,
    );
    expect(vaultHistoryRequestSchema.safeParse({ path: "a.md", skip: -1 }).success).toBe(false);
  });
});

describe("the asset bound", () => {
  it("never exceeds the hosted route's own ceiling", () => {
    expect(VAULT_ASSET_MAX_BYTES).toBeLessThanOrEqual(CLOUD_ASSET_MAX_BYTES);
  });
});

describe("assetWrite", () => {
  const file = new Blob([new Uint8Array([0])]);

  it("holds `dir` to the vault path grammar", () => {
    expect(
      vaultAssetWriteRequestSchema.safeParse({ baseName: "a.png", dir: "../outside", file })
        .success,
    ).toBe(false);
    expect(
      vaultAssetWriteRequestSchema.safeParse({ baseName: "a.png", dir: "assets", file }).success,
    ).toBe(true);
  });

  it("takes the bytes as a Blob, never as text, and refuses an empty one", () => {
    expect(
      vaultAssetWriteRequestSchema.safeParse({ baseName: "a.png", dir: "", file: "AA==" }).success,
    ).toBe(false);
    expect(
      vaultAssetWriteRequestSchema.safeParse({ baseName: "a.png", dir: "", file: new Blob([]) })
        .success,
    ).toBe(false);
  });
});
