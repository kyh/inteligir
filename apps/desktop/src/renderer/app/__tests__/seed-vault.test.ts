import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeMarkdown, toCanonical } from "@repo/editor/markdown/markdown-doc";
import { commentSidecarSchema } from "@repo/notes/comments/sidecar-schema";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { resolveSeedDir } from "inteligir/server/vault/seed-vault";

// asserted here rather than beside the seed: the fixpoint serializer is browser-side.
const REPO_ROOT = resolve(import.meta.dirname, "../../../../../..");
const seedDir = join(REPO_ROOT, "apps", "cli", "seed");
const entries = readdirSync(seedDir);
const docs = entries.filter((name) => name.endsWith(".md"));
const storeDir = join(seedDir, ".inteligir", "comments");
const stores = readdirSync(storeDir);

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

  it.each(stores)(
    "%s parses under the sidecar schema and is keyed by a shipped note's id",
    (name) => {
      const parsed = commentSidecarSchema.parse(
        JSON.parse(readFileSync(join(storeDir, name), "utf8")),
      );
      expect(Object.keys(parsed).length).toBeGreaterThan(0);
      const ids = docs.map((doc) => frontmatterId(readFileSync(join(seedDir, doc), "utf8")));
      expect(ids).toContain(name.replace(/\.json$/u, ""));
    },
  );

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
