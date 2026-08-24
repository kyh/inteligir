// The seed vault's contract: every shipped .md is BYTE-CANONICAL through the
// fixpoint serializer (a seed that churns on first save greets a new user
// with a diff they never made), every sidecar parses under the strict
// schema, every referenced asset ships, and the resolver actually finds the
// directory this suite just read.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeMarkdown, toCanonical } from "@repo/editor/markdown/markdown-doc";
import { commentSidecarSchema } from "@repo/notes/comments/sidecar-schema";
import { resolveSeedDir } from "inteligir/server/vault/seed-vault";

// The seed SHIPS with the server (it is what a virgin vault is populated
// from) and is ASSERTED here, because what makes it a contract is the editor's
// fixpoint serializer — which is browser-side and cannot be reached from the
// server's own program.
const REPO_ROOT = resolve(import.meta.dirname, "../../../../../..");
const seedDir = join(REPO_ROOT, "apps", "cli", "seed");
const entries = readdirSync(seedDir);
const docs = entries.filter((name) => name.endsWith(".md"));
const sidecars = entries.filter((name) => name.endsWith(".comments.json"));

describe("seed vault", () => {
  it("ships the starter set", () => {
    expect(docs.toSorted()).toEqual([
      "Getting Started.md",
      "Kitchen Sink.md",
      "Use Cases.md",
      "Welcome.md",
    ]);
  });

  it.each(docs)("%s is byte-canonical through the fixpoint", (name) => {
    const raw = readFileSync(join(seedDir, name), "utf8");
    expect(toCanonical(raw)).toBe(raw);
    expect(analyzeMarkdown(raw)).toEqual({ canonical: true, rawReason: null, richSafe: true });
  });

  it.each(sidecars)("%s parses under the sidecar schema beside its note", (name) => {
    const parsed = commentSidecarSchema.parse(
      JSON.parse(readFileSync(join(seedDir, name), "utf8")),
    );
    expect(Object.keys(parsed).length).toBeGreaterThan(0);
    expect(docs).toContain(name.replace(/\.comments\.json$/u, ""));
  });

  it("every referenced asset ships, and no shipped asset is orphaned", () => {
    const shipped = readdirSync(join(seedDir, "assets")).toSorted();
    const referenced = new Set<string>();
    for (const name of docs) {
      const raw = readFileSync(join(seedDir, name), "utf8");
      for (const match of raw.matchAll(/\(assets\/([^)]+)\)/gu)) {
        const file = match[1];
        if (file !== undefined) referenced.add(file);
      }
    }
    expect([...referenced].toSorted((a, b) => a.localeCompare(b))).toEqual(
      shipped.toSorted((a, b) => a.localeCompare(b)),
    );
  });

  it("the resolver finds this same directory from the source layout", () => {
    expect(resolveSeedDir()).toBe(seedDir);
  });
});
