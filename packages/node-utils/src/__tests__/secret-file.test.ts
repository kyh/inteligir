import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteSecretFile, readOrCreateSecretFile, writeSecretFile } from "../secret-file";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-secret-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readOrCreateSecretFile", () => {
  it("creates a secret at 0600 and returns the same value on re-read", async () => {
    const dataDir = makeTempDir();
    const args = {
      bytes: 32,
      dataDir,
      encoding: "hex",
      fileName: "auth-secret",
    } as const;

    const created = await readOrCreateSecretFile(args);
    expect(created).toMatch(/^[0-9a-f]{64}$/);

    const mode = (await stat(join(dataDir, "auth-secret"))).mode & 0o777;
    expect(mode).toBe(0o600);

    const reread = await readOrCreateSecretFile(args);
    expect(reread).toBe(created);
  });

  it("adopts an existing non-empty file", async () => {
    const dataDir = makeTempDir();
    const path = join(dataDir, "token");
    await writeSecretFile(path, "existing-value\n");

    const value = await readOrCreateSecretFile({
      bytes: 32,
      dataDir,
      encoding: "hex",
      fileName: "token",
    });
    expect(value).toBe("existing-value");
  });
});

describe("writeSecretFile", () => {
  it("writes at 0600, creating parent directories", async () => {
    const dataDir = makeTempDir();
    const path = join(dataDir, "nested", "dir", "secret");
    await writeSecretFile(path, "value-1");
    expect(await readFile(path, "utf8")).toBe("value-1");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("replaces atomically without leaving temp files", async () => {
    const dataDir = makeTempDir();
    const path = join(dataDir, "secret");
    await writeSecretFile(path, "value-1");
    await writeSecretFile(path, "value-2");
    expect(await readFile(path, "utf8")).toBe("value-2");

    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dataDir)).toEqual(["secret"]);
  });
});

describe("deleteSecretFile", () => {
  it("deletes, and tolerates a missing file", async () => {
    const dataDir = makeTempDir();
    const path = join(dataDir, "secret");
    await writeSecretFile(path, "value");
    await deleteSecretFile(path);
    await expect(deleteSecretFile(path)).resolves.toBeUndefined();
  });
});
