import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "inteligir/server/testing";
import { describe, expect, it, vi } from "vitest";
import { createServerLog, serverLogPath } from "../server-log";

const logIn = (maxBytes?: number) => {
  const dataDir = makeTempDir("inteligir-server-log-");
  const filePath = serverLogPath(dataDir);
  const warn = vi.fn<(message: string) => void>();
  const log =
    maxBytes === undefined
      ? createServerLog({ filePath, warn })
      : createServerLog({ filePath, maxBytes, warn });
  return { filePath, log, warn };
};

const linesOf = (filePath: string): string[] =>
  readFileSync(filePath, "utf-8").split("\n").filter(Boolean);

// a stamped line's bytes, newline included: the stamp is an ISO instant, 24 characters
const stampedBytes = (message: string): number => 24 + 1 + Buffer.byteLength(message) + 1;

describe("the server's log", () => {
  it("appends each line the child printed, stamped, under the data dir's logs folder", () => {
    const { filePath, log, warn } = logIn();
    log.append("[boot] 120ms");
    log.append("[debug:watcher] change Note.md: kept\n[debug:watcher] delivered: Note.md");

    expect(filePath.endsWith(path.join("logs", "server.log"))).toBe(true);
    const lines = linesOf(filePath);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[boot\] 120ms$/u);
    expect(lines[2]).toMatch(/Z \[debug:watcher\] delivered: Note\.md$/u);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps an existing log and appends after it, as a relaunch finds it", () => {
    const { filePath, log } = logIn();
    log.append("first boot");
    createServerLog({ filePath, warn: () => {} }).append("second boot");
    expect(linesOf(filePath).map((line) => line.slice(25))).toEqual(["first boot", "second boot"]);
  });

  it("never grows past its cap by more than one line, and keeps one older file", () => {
    const line = "x".repeat(40);
    const cap = stampedBytes(line) * 5;
    const { filePath, log } = logIn(cap);
    for (let index = 0; index < 23; index += 1) {
      log.append(line);
      expect(statSync(filePath).size).toBeLessThanOrEqual(cap + stampedBytes(line));
    }
    expect(readdirSync(path.dirname(filePath)).toSorted()).toEqual(["server.log", "server.log.1"]);
    expect(statSync(`${filePath}.1`).size).toBeLessThanOrEqual(cap);
    // five lines to a file: the backup holds lines 16 to 20, the log 21 to 23
    expect(linesOf(filePath)).toHaveLength(3);
    expect(linesOf(`${filePath}.1`)).toHaveLength(5);
  });

  it("measures a log it did not write before deciding to rotate it", () => {
    const line = "y".repeat(40);
    const cap = stampedBytes(line) * 5;
    const { filePath, log } = logIn(cap);
    log.append(line);
    writeFileSync(filePath, "z".repeat(cap));
    const fresh = createServerLog({ filePath, maxBytes: cap, warn: () => {} });
    fresh.append(line);
    expect(linesOf(filePath)).toHaveLength(1);
    expect(readFileSync(`${filePath}.1`, "utf-8")).toBe("z".repeat(cap));
  });

  it("swallows a folder it cannot write, and says so once", () => {
    const blocker = path.join(makeTempDir("inteligir-server-log-"), "not-a-dir");
    writeFileSync(blocker, "");
    const warn = vi.fn<(message: string) => void>();
    const log = createServerLog({ filePath: serverLogPath(blocker), warn });
    expect(() => {
      log.append("one");
      log.append("two");
    }).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(serverLogPath(blocker)));
  });
});
