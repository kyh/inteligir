// ---------------------------------------------------------------------------
// Model-selection seam: the agent/ seam carries a NEUTRAL
// {provider, modelId} pair; pi-ai's Model is resolved INSIDE the PiAgent
// wrapper at start(). Two contracts pinned here:
//   1. resolveModelSelection — static-registry + faux-registration resolution,
//      descriptive throws on unknown provider/model.
//   2. Lazy failure — a bad selection (or a throwing selectModel thunk) never
//      throws from construction; it rejects the async start() path. Resolution
//      is a lazy thunk precisely so a bad selection surfaces there, where
//      callers already handle failure, instead of from `new Agent(...)`.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { PiAgent } from "@repo/agent/pi/agent";
import { createModelRuntime } from "@repo/agent/pi/auth";
import { resolveModelSelection } from "@repo/agent/pi/model";
import { SessionManager } from "@repo/agent/pi/pi-types";

import { Agent } from "../agent";
import type { AgentPorts } from "../extension";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inteligir-model-selection-"));
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const unused = (): never => {
  throw new Error("port not used in this test");
};

/** Inert ports — start() fails before any extension ever registers. */
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
      listTags: () => [],
      listWikiTargets: () => [],
      getLinkGraph: () => ({ totalNotes: 0, totalLinks: 0, orphans: [], hubs: [], clusters: [] }),
      getSyncState: () => ({ enabled: false, status: { phase: "idle" }, conflicts: [] }),
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

describe("resolveModelSelection", () => {
  it("resolves each offered provider's default model in pi-ai's registry", () => {
    const openai = resolveModelSelection({ provider: "openai-codex", modelId: "gpt-5.5" });
    expect(openai.provider).toBe("openai-codex");
    expect(openai.id).toBe("gpt-5.5");

    const claude = resolveModelSelection({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
    expect(claude.provider).toBe("anthropic");
    expect(claude.id).toBe("claude-sonnet-4-6");
  });

  it("resolves faux through the live registration, not the static registry", () => {
    const model = resolveModelSelection({ provider: "faux", modelId: "faux-1" });
    expect(model.provider).toBe("faux");
    expect(model.api).toBe("faux");
  });

  it("throws descriptively for a model the provider doesn't know", () => {
    expect(() => resolveModelSelection({ provider: "anthropic", modelId: "gpt-5.5" })).toThrow(
      /not found/,
    );
    expect(() => resolveModelSelection({ provider: "faux", modelId: "nope" })).toThrow(/not found/);
  });

  it("throws descriptively for an unknown provider", () => {
    expect(() => resolveModelSelection({ provider: "not-a-provider", modelId: "x" })).toThrow(
      /not found/,
    );
  });
});

describe("lazy failure — bad selections reject start(), never construction", () => {
  it("PiAgent: constructing with a bad selection does not throw; start() rejects", async () => {
    const agent = new PiAgent({
      cwd: tmp,
      agentDir: tmp,
      modelRuntime: () => createModelRuntime(path.join(tmp, "auth.json")),
      model: { provider: "not-a-provider", modelId: "no-such-model" },
      sessionManager: SessionManager.inMemory(tmp),
      extensionFactories: [],
    });
    await expect(agent.start()).rejects.toThrow(/not found/);
  });

  it("Agent: a throwing selectModel thunk surfaces at start(), not construction", async () => {
    const agent = new Agent({
      ports: fakePorts(),
      ephemeralSession: true,
      selectModel: () => {
        throw new Error("selection exploded");
      },
    });
    expect(agent.getState()).toEqual({ status: "starting", error: null });
    await expect(agent.start()).rejects.toThrow("selection exploded");
  });

  it("Agent: a bad selection resolves lazily inside the wrapper and rejects start()", async () => {
    const agent = new Agent({
      ports: fakePorts(),
      ephemeralSession: true,
      selectModel: () => ({ provider: "not-a-provider", modelId: "no-such-model" }),
    });
    await expect(agent.start()).rejects.toThrow(/not found/);
  });
});
