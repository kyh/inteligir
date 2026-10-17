// the fill worker reads html it is handed and nothing else: no file under fill/, and not the
// worker's entry, may import a socket, a resolver or a process, so the page's own instructions
// (its links, its scripts, defuddle's async extractors) can reach nothing from this thread.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FILL = path.resolve(import.meta.dirname, "..");
const WORKER_ENTRY = path.resolve(FILL, "..", "item-fill-worker.ts");
const BANNED =
  /\bfrom\s+["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process|cluster)(?:\/[\w/]+)?["']|\bimport\(\s*["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process|cluster)\b/u;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sources(full);
    }
    return entry.name.endsWith(".ts") ? [full] : [];
  });

describe("the fill worker's program", () => {
  it.each([...sources(FILL), WORKER_ENTRY].map((file) => [path.relative(FILL, file), file]))(
    "%s imports no network or process module",
    (_name, file) => {
      expect(readFileSync(file, "utf-8")).not.toMatch(BANNED);
    },
  );

  it("refuses fetch before any job runs", () => {
    expect(readFileSync(WORKER_ENTRY, "utf-8")).toMatch(/globalThis\.fetch = /u);
  });
});
