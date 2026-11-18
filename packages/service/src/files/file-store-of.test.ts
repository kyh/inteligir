import path from "node:path";

import { describe, expect, it } from "vitest";

import { fileStoreModeOf } from "./file-store-of";

describe("the store a deployment keeps files in", () => {
  const folder = { BLOB_READ_WRITE_TOKEN: undefined, FILE_STORE_DIR: ".data/files" };

  it("is Blob wherever its key is set", () => {
    const keyed = { ...folder, BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" };

    for (const onVercel of [true, false]) {
      expect(fileStoreModeOf(keyed, onVercel)).toStrictEqual({
        kind: "blob",
        token: "vercel_blob_rw_x",
      });
    }
  });

  it("is a folder off Vercel, and nowhere on it, where a folder is one instance's", () => {
    expect(fileStoreModeOf(folder, false)).toStrictEqual({
      dir: path.resolve(".data/files"),
      kind: "disk",
    });
    expect(fileStoreModeOf(folder, true)).toStrictEqual({ kind: "off" });
  });
});
