import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defaultHarnessId } from "../agent-driver";
import { AgentPrefsStore, AgentPrefsStoreError } from "../agent-prefs-store";
import { createAgentsService, UnknownHarnessError } from "../agents-service";

const NOTHING_ON_PATH = { PATH: "/nonexistent-dir" };
const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-prefs-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe("the stored default", () => {
  it("is no choice until one is written, and survives a write", () => {
    const store = new AgentPrefsStore(scratch());
    expect(store.read()).toEqual({});
    store.write({ defaultHarness: "codex" });
    expect(store.read()).toEqual({ defaultHarness: "codex" });
  });

  it("refuses malformed bytes rather than reading them as no choice", () => {
    const dir = scratch();
    writeFileSync(join(dir, "agent-prefs.json"), "{");
    expect(() => new AgentPrefsStore(dir).read()).toThrow(AgentPrefsStoreError);
  });

  it("refuses a harness it does not know", () => {
    const dir = scratch();
    writeFileSync(join(dir, "agent-prefs.json"), JSON.stringify({ defaultHarness: "gemini" }));
    expect(() => new AgentPrefsStore(dir).read()).toThrow(AgentPrefsStoreError);
  });
});

describe("the harness a new thread starts on", () => {
  it("is the stored choice, ready or not", () => {
    expect(defaultHarnessId("codex", NOTHING_ON_PATH)).toBe("codex");
  });

  it("falls back to claude with nothing chosen", () => {
    expect(defaultHarnessId(null, NOTHING_ON_PATH)).toBe("claude");
  });
});

describe("the agents service", () => {
  it("stores a known harness and answers the new default", async () => {
    const store = new AgentPrefsStore(scratch());
    const agents = createAgentsService({ store, env: NOTHING_ON_PATH });
    expect((await agents.status()).defaultId).toBe("claude");
    expect((await agents.setDefault("codex")).defaultId).toBe("codex");
    expect(store.read()).toEqual({ defaultHarness: "codex" });
  });

  it("refuses an unknown harness without writing", async () => {
    const store = new AgentPrefsStore(scratch());
    const agents = createAgentsService({ store, env: NOTHING_ON_PATH });
    await expect(agents.setDefault("gemini")).rejects.toThrow(UnknownHarnessError);
    expect(store.read()).toEqual({});
  });
});
