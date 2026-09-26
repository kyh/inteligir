// the phone's two stores for the tests: the SQL port over a real file, and attachment files kept in
// memory under uris that name them

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";
import { openNodeSqlDriver } from "../../lib/node-sql-driver";
import type { AttachmentFiles } from "../attachment-files";

// a database file of its own, removed when the test ends; open it again to relaunch
export const tempDbPath = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "inteligir-phone-"));
  onTestFinished(() => {
    rmSync(dir, { force: true, recursive: true });
  });
  return path.join(dir, "inteligir.db");
};

export const openTempDb = (file: string = tempDbPath()) => {
  const db = openNodeSqlDriver(file);
  onTestFinished(() => {
    db.close();
  });
  return db;
};

export const createMemoryAttachments = (): AttachmentFiles & { names: () => string[] } => {
  const files = new Map<string, Uint8Array>();
  return {
    clear: async () => {
      files.clear();
    },
    find: async (name) => (files.has(name) ? `memory://${name}` : null),
    names: () => [...files.keys()],
    save: async (name, bytes) => {
      files.set(name, bytes);
      return `memory://${name}`;
    },
  };
};
