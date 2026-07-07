import { describe, expect, it } from "vitest";

import { createSyncIo } from "../sync-io";
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
});
