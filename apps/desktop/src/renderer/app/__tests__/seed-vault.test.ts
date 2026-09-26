import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeMarkdown, toCanonical } from "@repo/editor/markdown/markdown-doc";
import { commentSidecarSchema } from "@repo/notes/comments/sidecar-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { KnowledgeIndex } from "@repo/notes/knowledge/knowledge-index";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { resolveSeedDir } from "inteligir/server/vault/seed-vault";

// asserted here rather than beside the seed: the fixpoint serializer is browser-side.
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const seedDir = path.join(REPO_ROOT, "apps", "cli", "seed");
const entries = readdirSync(seedDir);
const docs = entries.filter((name) => name.endsWith(".md"));
const storeDir = path.join(seedDir, ".inteligir", "comments");
const stores = readdirSync(storeDir);
const seedFiles = readdirSync(seedDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) =>
    path.relative(seedDir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
  );

// the notes a new user reads as prose; Kitchen Sink is the construct tour, code blocks and all
const GUIDES = ["Getting Started.md", "Use Cases.md", "Welcome.md"];
// the reader takes notes and never sees the machinery the vault runs on; a code span opening on
// `inteligir` names the command, where a fence's `inteligir-chart` names a block
const MACHINERY =
  /\b(?:git|repo(?:sitory)?|commit|remote|cli|terminal|command line|vim|script|npx|mcp|coding agent)\b|(?<!`)`inteligir[\s`]|\binteligir command\b/iu;
const NO_PROBLEMS = { rows: [], total: 0 };

const machineryLines = (text: string): string[] =>
  text.split("\n").filter((line) => MACHINERY.test(line));

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
    const raw = readFileSync(path.join(seedDir, name), "utf-8");
    expect(toCanonical(raw)).toBe(raw);
    expect(analyzeMarkdown(raw)).toEqual({ kind: "canonical" });
  });

  it.each(GUIDES)("%s speaks to someone taking notes, not to a developer", (name) => {
    expect(machineryLines(readFileSync(path.join(seedDir, name), "utf-8"))).toEqual([]);
  });

  it.each(stores)(
    "%s parses under the sidecar schema and is keyed by a shipped note's id",
    (name) => {
      const parsed = commentSidecarSchema.parse(
        JSON.parse(readFileSync(path.join(storeDir, name), "utf-8")),
      );
      expect(Object.keys(parsed).length).toBeGreaterThan(0);
      const ids = docs.map((doc) => frontmatterId(readFileSync(path.join(seedDir, doc), "utf-8")));
      expect(ids).toContain(name.replace(/\.json$/u, ""));
      const texts = Object.values(parsed).map((comment) => comment.text);
      expect(texts.flatMap(machineryLines)).toEqual([]);
    },
  );

  it("every referenced asset ships, and no shipped asset is orphaned", () => {
    const shipped = readdirSync(path.join(seedDir, "assets")).toSorted();
    const referenced = new Set<string>();
    for (const name of docs) {
      const raw = readFileSync(path.join(seedDir, name), "utf-8");
      for (const match of raw.matchAll(/\(assets\/(?<file>[^)]+)\)/gu)) {
        const file = match.groups?.file;
        if (file !== undefined) {
          referenced.add(file);
        }
      }
    }
    expect([...referenced].toSorted((a, b) => a.localeCompare(b))).toEqual(
      shipped.toSorted((a, b) => a.localeCompare(b)),
    );
  });

  // a new vault's Problems page is what a new user finds there
  it("reports one problem, Kitchen Sink's deliberately dashed link", () => {
    const index = new KnowledgeIndex();
    for (const file of seedFiles) {
      if (isDocPath(file)) {
        index.setDoc(file, readFileSync(path.join(seedDir, file), "utf-8"));
      } else {
        index.setOther(file);
      }
    }
    const { unresolvedLinks, ...others } = index.problems({ limit: 20 });
    expect(unresolvedLinks.rows.map(({ sourcePath, target }) => ({ sourcePath, target }))).toEqual([
      { sourcePath: "Kitchen Sink.md", target: "Field Notes" },
    ]);
    expect(others).toEqual({
      duplicateIds: NO_PROBLEMS,
      duplicateStems: NO_PROBLEMS,
      missingEmbeds: NO_PROBLEMS,
      orphans: NO_PROBLEMS,
    });
  });

  it("the resolver finds this same directory from the source layout", () => {
    expect(resolveSeedDir()).toBe(seedDir);
  });
});
