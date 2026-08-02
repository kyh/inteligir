import { describe, expect, it } from "vitest";

import {
  CRAWL_FIXTURE_FILES,
  CRAWL_FIXTURE_MANIFEST,
} from "@repo/notes/sync/testing/crawl-fixture";

import {
  createSyncIo,
  VaultListingIncompleteError,
  VaultRootMissingError,
  type VaultFs,
} from "../sync-io";
import { memVaultFs } from "./fakes";

const decoder = new TextDecoder();

describe("createSyncIo", () => {
  it("lists every file recursively as sorted vault-relative paths", () => {
    const vault = memVaultFs();
    vault.writeText("z.md", "Z");
    vault.writeText("a.md", "A");
    vault.writeText("notes/deep/c.md", "C");
    vault.writeText("notes/b.md", "B");

    const io = createSyncIo(vault.fs);
    expect(io.list()).toEqual(["a.md", "notes/b.md", "notes/deep/c.md", "z.md"]);
  });

  it("returns an empty list for an empty vault", () => {
    expect(createSyncIo(memVaultFs().fs).list()).toEqual([]);
  });

  // Desktop and mobile crawl the same vault, so a name only one of them lists
  // is a deletion the other fans out on its next pass: it arrives, lands in
  // base, then reads as "in base, absent from local". Both walks answer from
  // ONE exclusion set (@repo/notes/sync/crawl-exclusions) and both pin
  // themselves against the SAME fixture — packages/vault's crawl test is the
  // other half of this assertion.
  it("classifies the shared crawl fixture exactly as desktop does", () => {
    const vault = memVaultFs();
    for (const rel of CRAWL_FIXTURE_FILES) vault.writeText(rel, "x");
    expect(createSyncIo(vault.fs).list().toSorted()).toEqual(CRAWL_FIXTURE_MANIFEST);
  });

  it("reads and writes bytes through the port", () => {
    const vault = memVaultFs();
    const io = createSyncIo(vault.fs);
    io.write("nested/dir/file.md", new TextEncoder().encode("hello"));
    expect(decoder.decode(io.read("nested/dir/file.md"))).toBe("hello");
    expect(vault.readText("nested/dir/file.md")).toBe("hello");
  });

  it("removes files idempotently", () => {
    const vault = memVaultFs();
    vault.writeText("gone.md", "bye");
    const io = createSyncIo(vault.fs);
    io.remove("gone.md");
    io.remove("gone.md"); // absent is fine
    expect(io.list()).toEqual([]);
  });

  // The engine's hash-cache fingerprint. THE INVARIANT: a content
  // change must move the fingerprint; any stat doubt must yield null (the
  // engine's re-hash fallback), never a guessed value that could license
  // reusing a stale hash.
  describe("fingerprint", () => {
    it("derives `lastModified:size` from the VaultFs stat", () => {
      const vault = memVaultFs();
      vault.writeText("a.md", "hello");
      const io = createSyncIo(vault.fs);
      const stat = vault.fs.stat("a.md");
      expect(stat).not.toBeNull();
      expect(io.fingerprint?.("a.md")).toBe(`${stat?.lastModified}:${stat?.size}`);
    });

    it("moves on a rewrite even when the content length is unchanged", () => {
      const vault = memVaultFs();
      vault.writeText("a.md", "hello");
      const io = createSyncIo(vault.fs);
      const before = io.fingerprint?.("a.md");
      vault.writeText("a.md", "world"); // same byte length — only mtime moves
      expect(io.fingerprint?.("a.md")).not.toBe(before);
    });

    it("is null for an absent file", () => {
      expect(createSyncIo(memVaultFs().fs).fingerprint?.("missing.md")).toBeNull();
    });

    it("is null when the stat throws (fail toward re-hashing)", () => {
      const vault = memVaultFs();
      vault.writeText("a.md", "hello");
      const throwingStat: VaultFs = {
        ...vault.fs,
        stat: () => {
          throw new Error("stat failed");
        },
      };
      expect(createSyncIo(throwingStat).fingerprint?.("a.md")).toBeNull();
    });
  });

  // The VaultFs contract: a missing ROOT throws (expo-vault-fs's
  // listDir("")), and list() must PROPAGATE it — never swallow it into an
  // empty listing, which the engine would reconcile as a mass deletion.
  it("propagates a root-missing throw instead of listing an empty vault (#429)", () => {
    const vault = memVaultFs();
    vault.writeText("a.md", "A");
    const rootMissing: VaultFs = {
      ...vault.fs,
      listDir: (relDir) => {
        if (relDir === "") throw new VaultRootMissingError();
        return vault.fs.listDir(relDir);
      },
    };
    expect(() => createSyncIo(rootMissing).list()).toThrow(VaultRootMissingError);
    expect(() => createSyncIo(rootMissing).list()).toThrow(/mass deletion/);
  });
});

// A vanished SUB-directory is the same mass-deletion hazard as a missing root
// but harder to see: siblings still list, so the overall result is non-empty
// and the empty-vault guard never fires. Returning `[]` for the subtree is
// therefore forbidden — desktop refuses a partial crawl for the same reason.
describe("incomplete subtree", () => {
  const withMissingSubdir: VaultFs = {
    listDir: (relDir) => {
      if (relDir === "") {
        return [
          { name: "notes", isDirectory: true },
          { name: "top.md", isDirectory: false },
        ];
      }
      if (relDir === "notes") throw new VaultListingIncompleteError("notes");
      return [];
    },
    readBytes: () => new Uint8Array(),
    writeBytes: () => {},
    remove: () => {},
    stat: () => null,
  };

  it("refuses the whole listing rather than reporting a partial vault", () => {
    // Crucially NOT "returns [top.md]" — that is the shape that deletes
    // everything under notes/ on every peer.
    expect(() => createSyncIo(withMissingSubdir).list()).toThrow(VaultListingIncompleteError);
  });
});
