import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loopbackOrigin,
  mintServerToken,
  readServerFile,
  removeServerFile,
  SERVER_FILE_NAME,
  writeServerFile,
} from "../server-file";
import { makeTempDir } from "./temp-dir";

const ROW = { pid: 42, port: 4664, token: "tok", vaultDir: "/vault", version: "1.2.3" };

describe("the server file", () => {
  it("round-trips the row a caller needs to reach this instance, its release included", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    writeServerFile(dataDir, ROW);
    expect(readServerFile(dataDir)).toEqual(ROW);
  });

  it("is owner-only, and stays so when it is rewritten", () => {
    // writeFileSync's mode applies only on create, so the chmod simulates a file inherited from a laxer umask.
    const dataDir = makeTempDir("inteligir-server-file-");
    writeServerFile(dataDir, ROW);
    chmodSync(path.join(dataDir, SERVER_FILE_NAME), 0o644);
    writeServerFile(dataDir, { ...ROW, port: 4665 });
    // oxlint-disable-next-line no-bitwise -- masking the permission bits out of a stat mode
    expect(statSync(path.join(dataDir, SERVER_FILE_NAME)).mode & 0o777).toBe(0o600);
  });

  it("answers null for a data dir with no server, and for a row it cannot parse", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    expect(readServerFile(dataDir)).toBeNull();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, SERVER_FILE_NAME), "{ not json", "utf-8");
    expect(readServerFile(dataDir)).toBeNull();
    writeFileSync(path.join(dataDir, SERVER_FILE_NAME), JSON.stringify({ port: 4664 }), "utf-8");
    expect(readServerFile(dataDir)).toBeNull();
  });

  it("removes the row, so a stale one never sends the next caller at a dead port", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    writeServerFile(dataDir, ROW);
    removeServerFile(dataDir, ROW.token);
    expect(readServerFile(dataDir)).toBeNull();
    expect(() => {
      removeServerFile(dataDir, ROW.token);
    }).not.toThrow();
  });

  it("keeps a row another boot wrote: A's shutdown leaves B's address in place", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    const rowB = { ...ROW, pid: 43, port: 4665, token: "boot-b" };
    writeServerFile(dataDir, rowB);
    removeServerFile(dataDir, "boot-a");
    expect(readServerFile(dataDir)).toEqual(rowB);
  });

  it("names the loopback server by address, never by name", () => {
    expect(loopbackOrigin(4664)).toBe("http://127.0.0.1:4664");
  });

  it("mints a fresh token per boot — a persisted one is replayable", () => {
    expect(mintServerToken()).not.toBe(mintServerToken());
    expect(mintServerToken().length).toBeGreaterThan(32);
  });

  it("never writes the token into a file anything but the owner can read", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    const token = mintServerToken();
    writeServerFile(dataDir, { ...ROW, token });
    expect(readFileSync(path.join(dataDir, SERVER_FILE_NAME), "utf-8")).toContain(token);
  });
});
