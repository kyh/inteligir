// ---------------------------------------------------------------------------
// TOOL-SURFACE BUDGET — the other thing we ship into every system prompt.
//
// agents-file-budget.test.ts bounds the repo-authored INSTRUCTION files. This
// bounds the repo-authored TOOL DESCRIPTIONS, which cost the same way for the
// same reason: every tool a session offers rides in the system prompt on every
// turn, name + description + JSON-Schema parameters, re-sent whether or not
// the model calls it. The grant table makes adding a capability cheap on
// purpose — one row, one tool — so the cost of the surface as a whole is the
// thing no single edit is ever confronted with.
//
// Descriptions are worth their bytes: a model that guesses at a tool costs far
// more than the sentence that would have told it. So this is a CEILING with
// slack, not a target — the failure it catches is drift, a surface that grew
// 300 chars at a time until it outweighed the instructions.
//
// The measured surface is the grant-governed bundles (the ones handed a
// privacy-projecting port), because those are the ones the table's `.push()`
// makes easy to grow. pi's own machine-access tools are pi's bytes, not ours.
//
// The editor's two sessions are NOT measured and must not be: inline AI and
// ghost text pass `allowedToolNames: []`, a hard registry filter, so none of
// this reaches the prompt that runs at typing cadence. If that ever changes,
// this budget is the wrong number by an order of magnitude.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { AGENT_GRANTS } from "@repo/bridge/agent-grants";

import knowledgeTools from "../knowledge-tools/extension";
import vaultTools from "../vault-tools/extension";
import type { AgentPorts, PiExtensionBundle } from "../extension";
import type { ExtensionAPI } from "@repo/agent/pi/pi-types";

/**
 * Ceiling for the whole vault-facing tool surface, in characters of prompt.
 * ~11.4k today across 20 tools is roughly 3k tokens on every chat turn — the
 * same order as the bundled AGENTS.md, which is why it deserves the same kind
 * of number. The slack is deliberately thin: a ceiling a doubled description
 * still fits under measures nothing. Raising it means deciding that another
 * capability is worth more per-turn context than the instructions already
 * there; that is a decision, not a paragraph someone appended.
 *
 * Sentences shared by many tools do not belong in any of them — the result
 * shape every listing returns is stated once in the bundled AGENTS.md, and a
 * new one that would repeat across bundles goes the same way.
 */
const TOOL_SURFACE_MAX_CHARS = 12_000;

/**
 * Ceiling for ONE tool, name + description + serialized parameter schema. Past
 * this it is prose that belongs in the bundled instructions (stated once)
 * rather than on a tool (re-stated in every turn that offers it). The largest
 * today is toggle_task at ~890, whose argument rules are the reason the write
 * refuses instead of ticking the wrong box.
 */
const SINGLE_TOOL_MAX_CHARS = 1_000;

const unused = (): never => {
  throw new Error("port not called during registration");
};

/** Inert ports: registration only closes over them. `actions` is non-null so
 * the mutating tiers register — the chat session is the expensive one. */
function fakePorts(): AgentPorts {
  return {
    executor: {
      cli: { name: "executor", version: "0.0.0", binPath: "/fake/bin/executor" },
      install: async () => {},
      start: async () => false,
      execute: unused,
      resume: unused,
    },
    knowledge: {
      search: () => [],
      backlinks: () => [],
      forwardLinks: () => [],
      relatedNotes: () => [],
      notesWithTag: () => [],
      rename: () => ({ ok: false, reason: "not wired in this test" }),
    },
    vault: {
      listVault: () => [],
      readVaultDoc: () => null,
      getVaultFileFacts: () => null,
      listVaultTasks: () => [],
      listTags: () => ({ ok: true, tags: [] }),
      listWikiTargets: () => [],
      getLinkGraph: () => ({
        ok: true,
        graph: { totalNotes: 0, totalLinks: 0, orphans: [], hubs: [], clusters: [] },
      }),
      listDelegations: () => [],
    },
    actions: {
      toggleTask: () => ({ ok: false, reason: "not wired in this test" }),
      delegateTask: () => ({ ok: false, reason: "not wired in this test" }),
      cancelDelegation: () => ({ ok: false, reason: "not wired in this test" }),
      restoreDelegation: async () => ({ ok: false, reason: "not wired in this test" }),
      deleteNote: async () => ({ ok: false, reason: "not wired in this test" }),
      undoMyEdit: async () => ({ ok: false, reason: "not wired in this test" }),
    },
    privacy: {
      probe: () => "indeterminate",
      vaultRealRoot: () => null,
      vaultLexicalRoot: () => null,
      privateIndexPaths: () => [],
    },
    checkpoints: null,
  };
}

type PromptTool = { name: string; chars: number };

/** What one tool costs in the prompt: its name, its description, and the
 * serialized parameter schema — argument descriptions included, because those
 * ship too and are where a schema quietly doubles. */
async function promptTools(bundles: PiExtensionBundle[]): Promise<PromptTool[]> {
  const tools: PromptTool[] = [];
  const pi = new Proxy(
    {
      registerTool: (tool: { name: string; description?: string; parameters?: unknown }) => {
        tools.push({
          name: tool.name,
          chars:
            tool.name.length +
            (tool.description ?? "").length +
            JSON.stringify(tool.parameters ?? {}).length,
        });
      },
    },
    { get: (target, prop) => Reflect.get(target, prop) ?? (() => {}) },
  ) as unknown as ExtensionAPI;
  for (const bundle of bundles) {
    await bundle.register({ binDir: "/fake/bin", ports: fakePorts() })(pi);
  }
  return tools;
}

describe("vault-facing tool surface", () => {
  it("stays within the per-turn prompt budget", async () => {
    const tools = await promptTools([knowledgeTools, vaultTools]);
    const total = tools.reduce((sum, tool) => sum + tool.chars, 0);
    expect(
      total,
      `the vault-facing tools cost ${total} chars of system prompt on EVERY chat turn ` +
        `(${tools.length} tools). Cut a description, move a shared sentence into the bundled ` +
        `AGENTS.md, or raise TOOL_SURFACE_MAX_CHARS with a reason.`,
    ).toBeLessThanOrEqual(TOOL_SURFACE_MAX_CHARS);
  });

  it("keeps any single tool from becoming a document", async () => {
    const tools = await promptTools([knowledgeTools, vaultTools]);
    const oversized = tools.filter((tool) => tool.chars > SINGLE_TOOL_MAX_CHARS);
    expect(
      oversized.map((tool) => `${tool.name} (${tool.chars})`),
      "a tool this long is instructions wearing a tool's clothes — state it once in the " +
        "bundled AGENTS.md instead",
    ).toEqual([]);
  });

  it("measures every granted tool, so the budget cannot be dodged by adding a bundle", async () => {
    const measured = new Set((await promptTools([knowledgeTools, vaultTools])).map((t) => t.name));
    const unmeasured = AGENT_GRANTS.map((grant) => grant.agentName).filter(
      (name) => !measured.has(name),
    );
    expect(
      unmeasured,
      "granted tools no budget covers — add their bundle to this test:\n" +
        unmeasured.map((name) => `  ${name}`).join("\n"),
    ).toEqual([]);
  });
});
