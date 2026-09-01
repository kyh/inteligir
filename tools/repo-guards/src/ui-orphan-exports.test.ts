// ---------------------------------------------------------------------------
// Orphan-export guard over @repo/ui: every named export of every file under
// the package's wildcard-exported directories must be reachable from a
// consumer — an import naming it from another workspace, or from another file
// inside the package. The component gallery does not count.
//
// PER EXPORT, not per file, because a file guard cannot see intra-file rot: a
// thousand-line component with one used export and four unused sub-APIs
// passes a file-level sweep forever. knip structurally cannot ask this
// question either — the package's exports map wildcards every directory, so
// every file is a public entry whose exports knip trusts as API (its
// includeEntryExports pass still counts the gallery as a consumer).
//
// A file none of whose exports has a consumer is reported here with every
// export listed, so no per-file orphan guard is needed beside this one.
//
// Adding an export you have not wired up yet? Wire it up, add its file to
// AWAITING_CONSUMER (a whole component held for a coming surface), or add an
// ALLOWED_EXPORTS row with the reason it must stay exported.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { REPO_ROOT, sourceOf, workspaces, workspaceSourceFiles } from "./repo";

const UI_DIR = "packages/ui";
const UI_PACKAGE = "@repo/ui";

/**
 * The component gallery imports EVERY component by design, so counting it as
 * a consumer would answer this guard's question before it was asked. A
 * gallery proves a component RENDERS, not that the product NEEDS it.
 */
const NON_CONSUMER_DIRS = ["apps/desktop/src/renderer/app/gallery"];

/**
 * The Beautiful UI set is held WHOLE by owner decision: these fourteen have no
 * product surface yet and are kept for one the product will grow. Named PER
 * FILE so a fifteenth unwired component still fails, and a meta test below
 * fails when an entry outlives its file.
 */
const AWAITING_CONSUMER = new Set([
  "packages/ui/src/ai/chat.tsx",
  "packages/ui/src/ai/code-block.tsx",
  "packages/ui/src/ai/context-cards.tsx",
  "packages/ui/src/ai/diff-table.tsx",
  "packages/ui/src/ai/filter-table.tsx",
  "packages/ui/src/ai/fine-tune-card.tsx",
  "packages/ui/src/ai/flowchart.tsx",
  "packages/ui/src/ai/insight-cards.tsx",
  "packages/ui/src/ai/prompt-bar.tsx",
  "packages/ui/src/ai/recommendation-card.tsx",
  "packages/ui/src/ai/records-table.tsx",
  "packages/ui/src/ai/search.tsx",
  "packages/ui/src/ai/selection-actions.tsx",
  "packages/ui/src/ai/sidebar-nav.tsx",
]);

/**
 * Single exports allowed to stand without a consumer, each with the reason it
 * must stay exported anyway. Keyed `<repo-relative file>#<export name>`. A
 * row here is a decision, not a backlog — and a meta test below fails when a
 * row outlives its export.
 */
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

/** The swept roots, derived from the package's own exports map: every
 *  `./<dir>/*` wildcard row publishes `src/<dir>`, which is exactly the set of
 *  directories whose files are orphanable public entries. */
function sweptRoots(): { dir: string; subpath: string }[] {
  const manifestPath = path.join(REPO_ROOT, UI_DIR, "package.json");
  const parsed = z
    .looseObject({ exports: z.record(z.string(), z.string()) })
    .safeParse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  if (!parsed.success) {
    throw new Error(`${manifestPath}: expected an "exports" map of subpath → file`);
  }
  const roots: { dir: string; subpath: string }[] = [];
  for (const [key, target] of Object.entries(parsed.data.exports)) {
    const wildcard = /^\.\/([\w-]+)\/\*$/.exec(key);
    if (wildcard?.[1] !== undefined && target.startsWith("./src/")) {
      roots.push({ dir: wildcard[1], subpath: wildcard[1] });
    }
  }
  if (roots.length === 0) {
    throw new Error(
      `${manifestPath}: no "./<dir>/*" wildcard exports found — the guard has nothing to sweep`,
    );
  }
  return roots;
}

const SOURCE_FILE = /\.tsx?$/;

/** One file's exported names, read from its source (full-line comments
 *  already stripped by `sourceOf`). Shapes this cannot attribute a name to —
 *  `export *` — throw rather than pass silently. */
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
      for (const entry of body.split(",")) {
        const cleaned = entry.replace(/^\s*type\s+/, "").trim();
        if (cleaned === "") continue;
        // `A as B` exports the name AFTER `as`.
        const parts = cleaned.split(/\s+as\s+/);
        const exported = parts[parts.length - 1]?.trim();
        if (exported !== undefined && exported !== "") names.push(exported);
      }
    }
    match = list.exec(source);
  }
  if (/^export\s+default\b/m.test(source)) names.push("default");
  return [...new Set(names)];
}

interface Consumption {
  /** Named imports (originals, before any `as` rename). */
  names: Set<string>;
  /** `* as ns` — consumes every export. */
  namespace: boolean;
  /** `import X from` — consumes the default export. */
  defaultImport: boolean;
}

/** What one consumer file imports from one specifier. The negated-quote body
 *  keeps the lazy clause from crossing into another statement's specifier. */
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
        for (const entry of braces[1].split(",")) {
          const cleaned = entry.replace(/^\s*type\s+/, "").trim();
          if (cleaned === "") continue;
          // `A as B` imports the name BEFORE `as`.
          const original = cleaned.split(/\s+as\s+/)[0]?.trim();
          if (original !== undefined && original !== "") result.names.add(original);
        }
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
  /** Repo-relative path. */
  file: string;
  /** The `@repo/ui/<subpath>/<name>` specifier consumers import it by. */
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

/** Every source file in the repo that may consume a @repo/ui export, on
 *  repo.ts's own workspace walk (tests included — the same population the
 *  per-file guard read). */
function consumerFiles(): string[] {
  return workspaces()
    .flatMap((workspace) => workspaceSourceFiles(workspace))
    .filter((file) => !isNonConsumer(file));
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

  it("every NON_CONSUMER_DIRS entry names a directory that exists", () => {
    // An exclusion pointing nowhere excludes nothing, and the failure is
    // silent in the direction that matters: the gallery counts as a consumer
    // and every component it renders looks wired.
    const missing = NON_CONSUMER_DIRS.filter((dir) => !fs.existsSync(path.join(REPO_ROOT, dir)));
    expect(
      missing,
      `NON_CONSUMER_DIRS names directories that do not exist:\n${missing.map((dir) => `  ${dir}`).join("\n")}`,
    ).toEqual([]);
  });

  it("no AWAITING_CONSUMER entry outlives its file", () => {
    // The allowance is a promise to wire these, not a place to hide a deleted
    // path — a stale entry is how an allowance becomes permanent.
    const missing = [...AWAITING_CONSUMER].filter(
      (relative) => !fs.existsSync(path.join(REPO_ROOT, relative)),
    );
    expect(
      missing,
      `AWAITING_CONSUMER names files that do not exist:\n${missing.map((file) => `  ${file}`).join("\n")}`,
    ).toEqual([]);
  });

  it("no ALLOWED_EXPORTS row outlives its export", () => {
    // Same maintenance rule as AWAITING_CONSUMER, one level down: a row naming
    // a deleted export silently excuses the next export to take its name.
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
