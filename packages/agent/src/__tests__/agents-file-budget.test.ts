// ---------------------------------------------------------------------------
// AGENTS-FILE BUDGET — what we ship into every system prompt.
//
// Nothing in the path bounds an AGENTS.md. pi's DefaultResourceLoader reads
// each context file whole (agentDir + every cwd ancestor), our
// `agentsFilesOverride` appends the user's vault file to that list, and
// buildSystemPrompt concatenates every byte verbatim into
// `<project_instructions path="…">`. There is no cap, no slice, no warning at
// any layer — so a "truncation guard" would guard nothing, and the only
// failure mode left is COST: these bytes are re-sent on every turn of every
// session, including the ghost-text session that runs at typing cadence.
//
// So this file pins the two things that are actually load-bearing:
//   1. that pi still truncates nothing (drive pi's REAL buildSystemPrompt —
//      if an upgrade ever starts slicing, the budget story below changes and
//      this fails loudly instead of silently losing instructions);
//   2. a two-sided budget on the context bytes THIS REPO authors — a ceiling
//      so growth is a decision rather than a drift, and a floor so a
//      packaging or edit accident that empties the file fails here rather
//      than degrading every answer quietly.
//
// It does NOT bound the user's vault/AGENTS.md, which is unbounded input
// reaching the same prompt — that needs a cap in the host loader, not a test.
//
// pi's internals are not public exports, so system-prompt.js is reached by
// file path (as pi-path-parity.test.ts does). A throwing locator IS the
// signal: pi moved the module — re-verify by hand before touching it.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { AGENT_INSTRUCTIONS_SKELETON } from "@repo/bridge/agent-instructions";

import { composeAgentInstructions } from "../setup";

// ---- Budgets ---------------------------------------------------------------

/**
 * Ceiling for the bundled agent AGENTS.md — the file seeded into `AGENT_DIR`
 * and therefore loaded into EVERY pi session (chat, delegation, inline AI,
 * ghost text). At ~12k chars today it is roughly 3k tokens spent per turn;
 * the headroom here is deliberate slack, not an invitation. Growing past it
 * means trading tokens on the app's highest-frequency prompt, so it should be
 * a decision with a reason, not a paragraph someone appended.
 */
const BUNDLED_INSTRUCTIONS_MAX_CHARS = 16_000;

/**
 * Floor for the same file. The failure this catches is the opposite one: a
 * packaging step or an edit that leaves a stub behind. Nothing downstream
 * notices — the agent simply gets dumber — so the loss is pinned here.
 */
const BUNDLED_INSTRUCTIONS_MIN_CHARS = 4_000;

/**
 * Ceiling for the vault skeleton. These bytes are seeded into the user's own
 * AGENTS.md and read back into chat + delegation, so they are prompt too —
 * but they are starter prose the user is meant to replace, and long starter
 * prose reads as a form to fill in rather than an invitation to edit.
 */
const SKELETON_MAX_CHARS = 1_500;

// ---- Repo-authored context files -------------------------------------------

const BUNDLED_RESOURCES_DIR = fileURLToPath(new URL("../../resources/agent", import.meta.url));

/** pi's context-file candidates, in the order it probes a directory
 * (resource-loader.js::loadContextFileFromDir). It takes the FIRST match and
 * ignores the rest. */
const PI_CONTEXT_FILE_CANDIDATES = new Set(["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]);

/** What setup.ts SEEDS, not what the repo ships: the shipped prose plus the
 * never-granted section rendered from the grant table. The generated half costs
 * per-turn context exactly like the written half, so measuring the file alone
 * would leave a budget one `.push()` could walk out of. */
function bundledInstructions(): string {
  const file = path.join(BUNDLED_RESOURCES_DIR, "AGENTS.md");
  if (!fs.existsSync(file)) {
    throw new Error(`bundled agent instructions missing at ${file} — setup.ts seeds this file`);
  }
  return composeAgentInstructions(fs.readFileSync(file, "utf8"));
}

// ---- pi's real prompt builder ----------------------------------------------

type ContextFile = { path: string; content: string };
type BuildSystemPrompt = (options: {
  cwd: string;
  contextFiles: ContextFile[];
  customPrompt?: string;
  selectedTools: string[];
  toolSnippets: Record<string, string>;
  promptGuidelines: string[];
}) => string;

const PI_PKG = fileURLToPath(
  new URL("../../node_modules/@earendil-works/pi-coding-agent", import.meta.url),
);

function piFile(...segments: string[]): string {
  const file = path.join(PI_PKG, "dist", ...segments);
  if (!fs.existsSync(file)) {
    throw new Error(
      `pi's dist/${segments.join("/")} not found at ${file} — pi moved it; re-verify by hand ` +
        `whether context files are still injected whole before updating this locator.`,
    );
  }
  return file;
}

/** Parse-at-boundary for a deep import: demand the export exists and is
 * callable. The structural shape above is unverifiable at runtime — the
 * assertions below are what actually exercise it. */
function isBuildSystemPrompt(value: unknown): value is BuildSystemPrompt {
  return typeof value === "function";
}

function pickBuildSystemPrompt(mod: unknown): BuildSystemPrompt {
  if (typeof mod !== "object" || mod === null) {
    throw new Error("pi's system-prompt module did not load — re-verify by hand");
  }
  const fn: unknown = Reflect.get(mod, "buildSystemPrompt");
  if (!isBuildSystemPrompt(fn)) {
    throw new Error(
      "pi no longer exports a callable buildSystemPrompt() — re-verify by hand whether " +
        "context files are still injected whole before updating this test",
    );
  }
  return fn;
}

let buildSystemPrompt: BuildSystemPrompt;

beforeAll(async () => {
  const mod: unknown = await import(
    /* @vite-ignore */ pathToFileURL(piFile("core/system-prompt.js")).href
  );
  buildSystemPrompt = pickBuildSystemPrompt(mod);
});

// ---- The constraint --------------------------------------------------------

describe("pi injects context files whole", () => {
  /** Far larger than any instruction file this repo ships, so a cap anywhere
   * in pi's prompt path would have to bite. */
  const OVERSIZED = "x".repeat(200_000);

  function promptWith(customPrompt?: string): string {
    return buildSystemPrompt({
      cwd: "/workspace",
      contextFiles: [{ path: "./vault/AGENTS.md", content: OVERSIZED }],
      selectedTools: [],
      toolSnippets: {},
      promptGuidelines: [],
      ...(customPrompt === undefined ? {} : { customPrompt }),
    });
  }

  it("passes an oversized context file through verbatim (default prompt)", () => {
    const prompt = promptWith();
    expect(prompt).toContain(`<project_instructions path="./vault/AGENTS.md">`);
    expect(prompt).toContain(OVERSIZED);
  });

  it("passes an oversized context file through verbatim (custom prompt)", () => {
    expect(promptWith("SYSTEM")).toContain(OVERSIZED);
  });
});

// ---- The budget ------------------------------------------------------------

describe("repo-authored context bytes", () => {
  it("keeps the seeded agent instructions within budget", () => {
    const chars = bundledInstructions().length;
    expect(
      chars,
      `the seeded agent instructions are ${chars} chars — they are re-sent on every ` +
        `turn of every session, including ghost text. Cut something, or raise ` +
        `BUNDLED_INSTRUCTIONS_MAX_CHARS with a reason.`,
    ).toBeLessThanOrEqual(BUNDLED_INSTRUCTIONS_MAX_CHARS);
  });

  it("catches a bundled-instructions file that lost its content", () => {
    expect(bundledInstructions().length).toBeGreaterThanOrEqual(BUNDLED_INSTRUCTIONS_MIN_CHARS);
  });

  it("keeps the seeded vault skeleton within budget", () => {
    expect(AGENT_INSTRUCTIONS_SKELETON.length).toBeLessThanOrEqual(SKELETON_MAX_CHARS);
  });

  it("ships exactly one file pi will load from the bundled resources dir", () => {
    const shipped = fs
      .readdirSync(BUNDLED_RESOURCES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => PI_CONTEXT_FILE_CANDIDATES.has(name));
    expect(
      shipped,
      "pi loads the FIRST context-file candidate it finds in a directory and silently " +
        "ignores the others — a second one here would never reach the prompt.",
    ).toEqual(["AGENTS.md"]);
  });
});
