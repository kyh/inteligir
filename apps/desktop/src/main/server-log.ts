// A Finder-launched app's stdout goes nowhere, so what the forked server prints is also appended
// to a file in its data dir, debug logging on or off: a report can attach it. One backup, so the
// log costs at most twice its cap.

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { toErrorMessage } from "../types";

const SERVER_LOG_MAX_BYTES = 5 * 1024 * 1024;

export const serverLogPath = (dataDir: string): string => path.join(dataDir, "logs", "server.log");

export interface ServerLogArgs {
  filePath: string;
  maxBytes?: number;
  warn: (message: string) => void;
}

export interface ServerLog {
  append: (message: string) => void;
}

const sizeOnDisk = (filePath: string): number => {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
};

export const createServerLog = (args: ServerLogArgs): ServerLog => {
  const maxBytes = args.maxBytes ?? SERVER_LOG_MAX_BYTES;
  const backupPath = `${args.filePath}.1`;
  // unknown until a write stats the file, and again after a failure, which may have moved it
  let size: number | null = null;
  // said once per run of failures: a full disk would otherwise say so on every line
  let failing = false;

  const write = (text: string): void => {
    if (size === null) {
      mkdirSync(path.dirname(args.filePath), { recursive: true });
      size = sizeOnDisk(args.filePath);
    }
    const bytes = Buffer.byteLength(text);
    if (size > 0 && size + bytes > maxBytes) {
      renameSync(args.filePath, backupPath);
      size = 0;
    }
    appendFileSync(args.filePath, text);
    size += bytes;
  };

  return {
    // main's own event handlers must not throw: a log that cannot be written costs the log alone
    append: (message) => {
      const stamp = new Date().toISOString();
      const text = message
        .split("\n")
        .map((line) => `${stamp} ${line}\n`)
        .join("");
      try {
        write(text);
        failing = false;
      } catch (error) {
        size = null;
        if (!failing) {
          failing = true;
          args.warn(
            `the server log could not be written (${args.filePath}): ${toErrorMessage(error)}`,
          );
        }
      }
    },
  };
};
