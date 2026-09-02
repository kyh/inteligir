// per export, not per file: a file guard cannot see a component with one used export and four
// unused sub-APIs. knip cannot ask this either: the exports map wildcards every directory, so every
// export is public API to it, and its includeEntryExports pass counts the gallery as a consumer.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, sourceOf, workspaces, workspaceSourceFiles } from "./repo";
import { GALLERY_DIR, sweptRoots, UI_DIR, UI_PACKAGE } from "./ui-package";

const NON_CONSUMER_DIRS = [GALLERY_DIR];

// held whole by owner decision, listed per file so an unlisted unwired component still fails; a
// held file is not a consumer.
const AWAITING_CONSUMER = new Set([
  "packages/ui/src/ai/chat.tsx",
  "packages/ui/src/ai/code-block.tsx",
  "packages/ui/src/ai/context-cards.tsx",
  "packages/ui/src/ai/diff-table.tsx",
  "packages/ui/src/ai/filter-table.tsx",
  "packages/ui/src/ai/fine-tune-card.tsx",
  "packages/ui/src/ai/flowchart.tsx",
  "packages/ui/src/ai/glide-list.tsx",
  "packages/ui/src/ai/insight-cards.tsx",
  "packages/ui/src/ai/prompt-bar.tsx",
  "packages/ui/src/ai/recommendation-card.tsx",
  "packages/ui/src/ai/records-table.tsx",
  "packages/ui/src/ai/search.tsx",
  "packages/ui/src/ai/selection-actions.tsx",
  "packages/ui/src/ai/sidebar-nav.tsx",
]);

// keyed `<repo-relative file>#<export name>`; a row is a decision, not a backlog.
const ALLOWED_EXPORTS = new Map<string, string>([
  [
    "packages/ui/src/ai/thinking.tsx#ThinkingTool",
    "The trace vocabulary's tool row — Step and Reasoning are wired; the third kind is held with the Beautiful UI set for the timeline that renders tool calls.",
  ],
  [
    "packages/ui/src/ai/task-rows.tsx#TaskItemDetails",
    "The consumed TaskRows surface's expandable half, held with the Beautiful UI set for the panel that grows per-row detail lines.",
  ],
  ["packages/ui/src/ai/task-rows.tsx#TaskDetail", "A row inside TaskItemDetails — held with it."],
  [
    "packages/ui/src/ai/approval-card.tsx#ApprovalActions",
    "The consumed ApprovalCard's multi-answer footer — single-choice questions commit on pick today; held for the first multi-answer approval.",
  ],
  [
    "packages/ui/src/ai/approval-card.tsx#ApprovalCustomAnswer",
    "The consumed ApprovalCard's free-text answer row — held with the approval vocabulary for prompts that take a typed reply.",
  ],
  [
    "packages/ui/src/ai/streaming-text.tsx#StreamingAction",
    "The consumed StreamingText's inline action chip — held with the Beautiful UI set for answer-with-actions turns.",
  ],
]);

const SOURCE_FILE = /\.tsx?$/;

interface BraceEntry {
  original: string;
  exported: string;
}

// the one tokenization both the export walk and the import walk read.
function braceEntries(body: string): BraceEntry[] {
  const entries: BraceEntry[] = [];
  for (const entry of body.split(",")) {
    const cleaned = entry.replace(/^\s*type\s+/, "").trim();
    if (cleaned === "") continue;
    const parts = cleaned.split(/\s+as\s+/);
    const original = parts[0]?.trim();
    const exported = parts[parts.length - 1]?.trim();
    if (original !== undefined && original !== "" && exported !== undefined && exported !== "") {
      entries.push({ original, exported });
    }
  }
  return entries;
}

function exportedNames(relativePath: string): string[] {
  const source = sourceOf(relativePath);
  if (/^export\s*\*/m.test(source)) {
    throw new Error(
      `${relativePath}: contains "export *", which this guard cannot attribute names to.\n` +
        `  fix: re-export by name, or teach ui-orphan-exports.test.ts the shape`,
    );
  }
  const names: string[] = [];
  const decl =
    /^export\s+(?:async\s+)?(?:const|let|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
  let match = decl.exec(source);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined) names.push(name);
    match = decl.exec(source);
  }
  const list = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
  match = list.exec(source);
  while (match !== null) {
    const body = match[1];
    if (body !== undefined) {
      for (const { exported } of braceEntries(body)) names.push(exported);
    }
    match = list.exec(source);
  }
  if (/^export\s+default\b/m.test(source)) names.push("default");
  return [...new Set(names)];
}

interface Consumption {
  names: Set<string>;
  namespace: boolean;
  defaultImport: boolean;
}

// the negated-quote body keeps the lazy clause from crossing into another statement's specifier.
function consumptionOf(source: string, specifier: string): Consumption {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const statement = new RegExp(
    String.raw`(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?([^;'"]*?)\s*from\s*["']${escaped}["']`,
    "g",
  );
  const result: Consumption = { names: new Set(), namespace: false, defaultImport: false };
  let match = statement.exec(source);
  while (match !== null) {
    const clause = match[1] ?? "";
    if (clause.startsWith("*")) {
      result.namespace = true;
    } else {
      const braces = /\{([^}]*)\}/.exec(clause);
      if (braces?.[1] !== undefined) {
        for (const { original } of braceEntries(braces[1])) result.names.add(original);
      }
      const beforeBraces = braces === null ? clause : clause.slice(0, braces.index);
      if (/^[A-Za-z_$][\w$]*\s*,?\s*$/.test(beforeBraces.trim()) && beforeBraces.trim() !== "") {
        result.defaultImport = true;
      }
    }
    match = statement.exec(source);
  }
  return result;
}

function isNonConsumer(relativePath: string): boolean {
  return NON_CONSUMER_DIRS.some((dir) => relativePath.startsWith(`${dir}/`));
}

interface UiFile {
  file: string;
  specifier: string;
}

function uiFiles(): UiFile[] {
  const found: UiFile[] = [];
  for (const root of sweptRoots()) {
    const rootDir = path.join(REPO_ROOT, UI_DIR, "src", root.dir);
    if (!fs.existsSync(rootDir)) continue;
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isFile() || !SOURCE_FILE.test(entry.name)) continue;
      const name = entry.name.replace(SOURCE_FILE, "");
      found.push({
        file: `${UI_DIR}/src/${root.dir}/${entry.name}`,
        specifier: `${UI_PACKAGE}/${root.subpath}/${name}`,
      });
    }
  }
  return found;
}

// tests included; a held file is not one, or its imports would keep every helper it reaches alive
// with no row naming them.
function consumerFiles(): string[] {
  return workspaces()
    .flatMap((workspace) => workspaceSourceFiles(workspace))
    .filter((file) => !isNonConsumer(file) && !AWAITING_CONSUMER.has(file));
}

describe("no orphan @repo/ui exports", () => {
  const files = uiFiles();
  const sweptDirs = sweptRoots()
    .map((root) => `src/${root.dir}`)
    .join(", ");

  it(`every export under ${sweptDirs} has a consumer outside the gallery`, () => {
    const consumers = consumerFiles();
    const orphans: string[] = [];

    for (const { file, specifier } of files) {
      if (AWAITING_CONSUMER.has(file)) continue;
      const names = exportedNames(file);
      const unconsumed = new Set(names.filter((name) => !ALLOWED_EXPORTS.has(`${file}#${name}`)));
      for (const consumer of consumers) {
        if (unconsumed.size === 0) break;
        if (consumer === file) continue;
        const source = sourceOf(consumer);
        if (!source.includes(specifier)) continue;
        const consumed = consumptionOf(source, specifier);
        if (consumed.namespace) {
          unconsumed.clear();
          break;
        }
        for (const name of consumed.names) unconsumed.delete(name);
        if (consumed.defaultImport) unconsumed.delete("default");
      }
      for (const name of [...unconsumed].toSorted()) {
        orphans.push(`  ${file} — ${name}`);
      }
    }

    expect(
      orphans,
      `@repo/ui exports with no importer outside the gallery.\n` +
        `Every named export under ${sweptDirs} must be reachable from a consumer —\n` +
        `the gallery does NOT count: it imports everything by design, and rendering\n` +
        `there is not the same claim as the product needing it.\n` +
        `Wire each up, delete it, or record it: a whole component held for a coming\n` +
        `surface goes in AWAITING_CONSUMER; a single export that must stay goes in\n` +
        `ALLOWED_EXPORTS with its reason (tools/repo-guards/src/ui-orphan-exports.test.ts):\n` +
        orphans.join("\n"),
    ).toEqual([]);
  });

  it("no AWAITING_CONSUMER file counts as a consumer", () => {
    const held = consumerFiles().filter((file) => AWAITING_CONSUMER.has(file));
    expect(
      held,
      `AWAITING_CONSUMER files counted as consumers:\n${held.map((file) => `  ${file}`).join("\n")}`,
    ).toEqual([]);
  });

  it("no ALLOWED_EXPORTS row outlives its export", () => {
    const stale = [...ALLOWED_EXPORTS.keys()].filter((key) => {
      const [file, name] = key.split("#");
      if (file === undefined || name === undefined) return true;
      if (!fs.existsSync(path.join(REPO_ROOT, file))) return true;
      return !exportedNames(file).includes(name);
    });
    expect(
      stale,
      `ALLOWED_EXPORTS rows whose export no longer exists — delete these:\n${stale.map((key) => `  ${key}`).join("\n")}`,
    ).toEqual([]);
  });
});
