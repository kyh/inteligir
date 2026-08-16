// ---------------------------------------------------------------------------
// Every `/v1/host/…` URL this repo's source SPELLS is one the host serves.
//
// `host-route.ts` declares the leaf table, and it is the only table: a path
// that does not match it is refused before any object is named. So a URL
// written anywhere else — a `fetch` a page issues, or a sentence an error
// hands the user — is a claim about that table, and the compiler cannot check
// a string. The failure it caught is the quiet one: a refusal that tells the
// caller to retry over a URL shape the router rejects, which reads as helpful
// and routes nobody anywhere.
//
// Textual, like the rest of this package: `apps/web` compiles under two tsconfig
// programs and its vitest project runs inside the Workers pool, where there is
// no filesystem to walk. Tests are excluded because a router test's job is to
// spell paths the router must REFUSE.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const HOST_ROUTE_FILE = path.join(REPO_ROOT, "apps/web/src/worker/host/host-route.ts");

/** The declared table, read from the one file that owns it. */
const LEAVES_BLOCK = /const HOST_LEAVES = \{([\s\S]*?)\n\} as const;/;
const LEAF_ROW = /^ {2}(\w+): "(?:GET|POST)",$/gm;

/**
 * A `/v1/host/` URL and the leaf segment that follows it.
 *
 * The character class ends the segment at everything a real spelling ends
 * with — `/`, `?`, a quote, a `${…}` interpolation — and matches none of the
 * PATTERNS prose uses for the whole family (`/v1/host/*`, `/v1/host/<leaf>`),
 * so documentation of the shape is not read as a claim about one route.
 */
const HOST_URL = /\/v1\/host\/([A-Za-z0-9_:.-]+)/g;

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".cache", ".turbo", ".output", ".git"]);

function sourceFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name) || entry.name === "__tests__") continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function declaredLeaves(): Set<string> {
  const source = fs.readFileSync(HOST_ROUTE_FILE, "utf8");
  const block = LEAVES_BLOCK.exec(source)?.[1];
  if (block === undefined)
    throw new Error(`HOST_LEAVES no longer parses out of ${HOST_ROUTE_FILE}`);
  return new Set([...block.matchAll(LEAF_ROW)].map((row) => row[1] ?? ""));
}

describe("host route spellings", () => {
  it("every /v1/host URL in source names a declared leaf", () => {
    const leaves = declaredLeaves();
    // A parse that silently found nothing would pass this suite vacuously.
    expect(leaves.size).toBeGreaterThan(0);

    const files: string[] = [];
    for (const dir of ["apps", "packages"]) sourceFiles(path.join(REPO_ROOT, dir), files);

    const unserved: string[] = [];
    for (const file of files) {
      for (const [url, leaf = ""] of fs.readFileSync(file, "utf8").matchAll(HOST_URL)) {
        if (!leaves.has(leaf)) unserved.push(`  ${path.relative(REPO_ROOT, file)}: ${url}`);
      }
    }

    expect(
      unserved,
      `URLs the host does not serve — host-route.ts refuses these before any object\n` +
        `is named, so nothing behind them can answer:\n${unserved.join("\n")}`,
    ).toEqual([]);
  });
});
