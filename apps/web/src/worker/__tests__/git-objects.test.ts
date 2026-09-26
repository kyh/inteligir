import { describe, expect, it } from "vitest";
import {
  blobObject,
  commitObject,
  FILE_MODE,
  gitIdent,
  sortTreeEntries,
  TREE_MODE,
  treeObject,
  writePack,
} from "../vault/git-objects";
import type { GitTreeEntry } from "../vault/git-objects";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const HELLO_BLOB = "ce013625030ba8dba906f756967f9e9ca394464a";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const entry = (name: string, mode: string, oid: string): GitTreeEntry => ({
  mode,
  name: encoder.encode(name),
  oid,
});

describe("git's object encodings", () => {
  it("hashes a blob and the empty tree to git's own oids", async () => {
    const hello = await blobObject(encoder.encode("hello\n"));
    const empty = await treeObject([]);
    expect(hello.oid).toBe(HELLO_BLOB);
    expect(empty.oid).toBe(EMPTY_TREE);
  });

  it("orders a tree by UTF-8 bytes, a folder as if it ended in a slash", async () => {
    // U+FF5A encodes below 😀 in UTF-8 and above its surrogates in UTF-16
    const entries = [
      entry("😀.md", FILE_MODE, HELLO_BLOB),
      entry("a", TREE_MODE, EMPTY_TREE),
      entry("ｚ.md", FILE_MODE, HELLO_BLOB),
      entry(".md", FILE_MODE, HELLO_BLOB),
      entry("a.md", FILE_MODE, HELLO_BLOB),
    ];
    expect(sortTreeEntries(entries).map((row) => decoder.decode(row.name))).toEqual([
      ".md",
      "a.md",
      "a",
      "ｚ.md",
      "😀.md",
    ]);
    const tree = await treeObject(entries);
    // `git mktree` over the same five entries
    expect(tree.oid).toBe("1af7a4a2ffaf09df2c2d9019daae3c70f10fba2e");
  });

  it("keeps a device name that spells a header on one ident line", async () => {
    const ident = gitIdent(
      { email: "device-1@inteligir.local", name: "Evil <x>\nparent 0" },
      1_700_000_000_999,
    );
    expect(ident).toBe("Evil xparent 0 <device-1@inteligir.local> 1700000000 +0000");

    const commit = await commitObject({
      author: ident,
      committer: ident,
      message: "vault: update a.md",
      parents: [],
      tree: EMPTY_TREE,
    });
    const [headers = ""] = decoder.decode(commit.body).split("\n\n");
    expect(headers.split("\n").map((line) => line.split(" ")[0])).toEqual([
      "tree",
      "author",
      "committer",
    ]);
  });

  it("packs each object once, counted in the header", async () => {
    const blob = await blobObject(encoder.encode("hello\n"));
    const pack = await writePack([blob, blob]);
    expect(decoder.decode(pack.subarray(0, 4))).toBe("PACK");
    expect(new DataView(pack.buffer, pack.byteOffset).getUint32(8)).toBe(1);
    const trailer = new Uint8Array(await crypto.subtle.digest("SHA-1", pack.subarray(0, -20)));
    expect(pack.subarray(-20)).toEqual(trailer);
  });
});
