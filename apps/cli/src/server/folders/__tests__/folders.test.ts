import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ORPCError, safe } from "@orpc/client";
import { CONNECTED_FOLDERS_MAX } from "@repo/contract/local/folders/folders-schema";
import { beforeEach, describe, expect, it } from "vitest";

import { createFoldersService, FolderRefusedError } from "../folders-service";
import type { FolderRefusal } from "../folders-service";
import { FoldersStore } from "../folders-store";
import { JsonFileStoreError } from "../../json-file-store";
import { bootTestApp } from "../../__tests__/boot-app";
import { makeTempDir } from "../../__tests__/temp-dir";

let root: string;
let dataDir: string;
let vaultDir: string;
let refDir: string;

beforeEach(() => {
  // realpath'd up front: mkdtemp under macOS's /var symlink would otherwise
  // make every containment comparison a symlink-vs-target mismatch.
  root = makeTempDir("folders-test-", { realpath: true });
  dataDir = path.join(root, "data");
  vaultDir = path.join(root, "vault");
  refDir = path.join(root, "reference");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(vaultDir, { recursive: true });
  mkdirSync(refDir, { recursive: true });
});

const service = () => createFoldersService({ dataDir, store: new FoldersStore(dataDir), vaultDir });

const refusal = (run: () => string[]): FolderRefusal | null => {
  try {
    run();
  } catch (error) {
    if (error instanceof FolderRefusedError) {
      return error.refusal;
    }
    throw error;
  }
  return null;
};

const ADD_INVALID_PATH: FolderRefusal = { code: "invalid_path", op: "add" };

// none of them on disk: the store holds spellings, and the cap counts rows
const fillToCap = (storeDir: string): void => {
  new FoldersStore(storeDir).write(
    Array.from({ length: CONNECTED_FOLDERS_MAX }, (_, index) =>
      path.join(storeDir, `full-${index}`),
    ),
  );
};

describe("folders store", () => {
  it("round-trips through the file and answers [] for a missing one", () => {
    const store = new FoldersStore(dataDir);
    expect(store.read()).toEqual([]);
    store.write([refDir]);
    expect(store.read()).toEqual([refDir]);
    expect(new FoldersStore(dataDir).read()).toEqual([refDir]);
  });

  it("surfaces a malformed file as an error, never an empty list", () => {
    writeFileSync(path.join(dataDir, "connected-folders.json"), "{nope", "utf-8");
    expect(() => new FoldersStore(dataDir).read()).toThrow(JsonFileStoreError);
  });
});

describe("folders service validation", () => {
  it("adds a real directory and lists it realpathed", () => {
    expect(service().add(refDir)).toEqual([refDir]);
  });

  it("refuses a relative path", () => {
    expect(refusal(() => service().add("reference"))).toEqual(ADD_INVALID_PATH);
  });

  it("refuses a missing path", () => {
    expect(refusal(() => service().add(path.join(root, "nope")))).toEqual(ADD_INVALID_PATH);
  });

  it("refuses a file", () => {
    const file = path.join(root, "a-file.txt");
    writeFileSync(file, "x", "utf-8");
    expect(refusal(() => service().add(file))).toEqual(ADD_INVALID_PATH);
  });

  it("refuses a folder inside the vault, and the vault itself", () => {
    const nested = path.join(vaultDir, "notes");
    mkdirSync(nested);
    expect(refusal(() => service().add(nested))).toEqual(ADD_INVALID_PATH);
    expect(refusal(() => service().add(vaultDir))).toEqual(ADD_INVALID_PATH);
  });

  it("refuses a folder containing the data dir", () => {
    expect(refusal(() => service().add(root))).toEqual(ADD_INVALID_PATH);
  });

  it("dedupes through symlinked spellings", () => {
    const alias = path.join(root, "reference-alias");
    symlinkSync(refDir, alias);
    const folders = service();
    folders.add(refDir);
    expect(refusal(() => folders.add(alias))).toEqual({ code: "already_exists", op: "add" });
  });

  it("removes by stored spelling even after the directory is gone", () => {
    const folders = service();
    folders.add(refDir);
    rmSync(refDir, { recursive: true });
    expect(folders.remove(refDir)).toEqual([]);
  });

  it("refuses a real folder past the cap as the cap, not as its path", () => {
    fillToCap(dataDir);
    expect(refusal(() => service().add(refDir))).toEqual({ code: "limit_reached", op: "add" });
  });

  it("remove refuses an unknown path", () => {
    expect(refusal(() => service().remove(refDir))).toEqual({ code: "not_found", op: "remove" });
  });
});

describe("folders procedures", () => {
  it("answer the cap as its own class", async () => {
    const harness = await bootTestApp();
    const reference = path.join(path.dirname(harness.dataDir), "reference");
    mkdirSync(reference);
    fillToCap(harness.dataDir);

    const [error] = await safe(harness.client.folders.add({ path: reference }));

    expect(error instanceof ORPCError && error.code).toBe("LIMIT_REACHED");
  });
});
