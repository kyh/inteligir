import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFoldersService, FolderRefusedError } from "../folders-service";
import { FoldersStore, FoldersStoreError } from "../folders-store";
import { makeTempDir } from "../../__tests__/temp-dir";

let root: string;
let dataDir: string;
let vaultDir: string;
let refDir: string;

beforeEach(() => {
  // realpath'd up front: mkdtemp under macOS's /var symlink would otherwise
  // make every containment comparison a symlink-vs-target mismatch.
  root = makeTempDir("folders-test-", { realpath: true });
  dataDir = join(root, "data");
  vaultDir = join(root, "vault");
  refDir = join(root, "reference");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(vaultDir, { recursive: true });
  mkdirSync(refDir, { recursive: true });
});

afterEach(() => {});

function service() {
  return createFoldersService({ store: new FoldersStore(dataDir), dataDir, vaultDir });
}

function refusalKind(run: () => string[]): string | null {
  try {
    run();
  } catch (error) {
    if (error instanceof FolderRefusedError) {
      return error.kind;
    }
    throw error;
  }
  return null;
}

describe("folders store", () => {
  it("round-trips through the file and answers [] for a missing one", () => {
    const store = new FoldersStore(dataDir);
    expect(store.read()).toEqual([]);
    store.write([refDir]);
    expect(store.read()).toEqual([refDir]);
    expect(new FoldersStore(dataDir).read()).toEqual([refDir]);
  });

  it("surfaces a malformed file as an error, never an empty list", () => {
    writeFileSync(join(dataDir, "connected-folders.json"), "{nope", "utf8");
    expect(() => new FoldersStore(dataDir).read()).toThrow(FoldersStoreError);
  });
});

describe("folders service validation", () => {
  it("adds a real directory and lists it realpathed", () => {
    expect(service().add(refDir)).toEqual([refDir]);
  });

  it("refuses a relative path", () => {
    expect(refusalKind(() => service().add("reference"))).toBe("invalid-path");
  });

  it("refuses a missing path", () => {
    expect(refusalKind(() => service().add(join(root, "nope")))).toBe("invalid-path");
  });

  it("refuses a file", () => {
    const file = join(root, "a-file.txt");
    writeFileSync(file, "x", "utf8");
    expect(refusalKind(() => service().add(file))).toBe("invalid-path");
  });

  it("refuses a folder inside the vault, and the vault itself", () => {
    const nested = join(vaultDir, "notes");
    mkdirSync(nested);
    expect(refusalKind(() => service().add(nested))).toBe("invalid-path");
    expect(refusalKind(() => service().add(vaultDir))).toBe("invalid-path");
  });

  it("refuses a folder containing the data dir", () => {
    expect(refusalKind(() => service().add(root))).toBe("invalid-path");
  });

  it("dedupes through symlinked spellings", () => {
    const alias = join(root, "reference-alias");
    symlinkSync(refDir, alias);
    const folders = service();
    folders.add(refDir);
    expect(refusalKind(() => folders.add(alias))).toBe("already-exists");
  });

  it("removes by stored spelling even after the directory is gone", () => {
    const folders = service();
    folders.add(refDir);
    rmSync(refDir, { recursive: true });
    expect(folders.remove(refDir)).toEqual([]);
  });

  it("remove refuses an unknown path", () => {
    expect(refusalKind(() => service().remove(refDir))).toBe("not-found");
  });
});
