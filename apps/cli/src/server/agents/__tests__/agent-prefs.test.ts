import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AgentPrefsStore } from "../agent-prefs-store";
import { JsonFileStoreError } from "../../json-file-store";
import { createAgentsService } from "../agents-service";
import type { AgentAccounts } from "../agent-sign-in";
import { fakeAgentAccounts } from "../../__tests__/boot-app";
import { makeTempDir } from "../../__tests__/temp-dir";

const NOTHING_ON_PATH = { PATH: "/nonexistent-dir" };
const scratch = (): string => makeTempDir("agent-prefs-");

describe("the stored default", () => {
  it("is no choice until one is written, and survives a write", () => {
    const store = new AgentPrefsStore(scratch());
    expect(store.read()).toEqual({});
    store.write({ defaultHarness: "codex" });
    expect(store.read()).toEqual({ defaultHarness: "codex" });
  });

  it("refuses malformed bytes rather than reading them as no choice", () => {
    const dir = scratch();
    writeFileSync(path.join(dir, "agent-prefs.json"), "{");
    expect(() => new AgentPrefsStore(dir).read()).toThrow(JsonFileStoreError);
  });

  it("refuses a harness it does not know", () => {
    const dir = scratch();
    writeFileSync(path.join(dir, "agent-prefs.json"), JSON.stringify({ defaultHarness: "gemini" }));
    expect(() => new AgentPrefsStore(dir).read()).toThrow(JsonFileStoreError);
    writeFileSync(
      path.join(dir, "agent-prefs.json"),
      JSON.stringify({ defaultHarness: "constructor" }),
    );
    expect(() => new AgentPrefsStore(dir).read()).toThrow(JsonFileStoreError);
  });
});

describe("the harness a new thread starts on", () => {
  it("is the stored choice, ready or not", () => {
    const store = new AgentPrefsStore(scratch());
    store.write({ defaultHarness: "codex" });
    expect(store.defaultHarness()).toBe("codex");
  });

  it("falls back to claude with nothing chosen, whatever PATH holds", async () => {
    expect(new AgentPrefsStore(scratch()).defaultHarness()).toBe("claude");
    const agents = createAgentsService({
      accounts: fakeAgentAccounts(),
      env: NOTHING_ON_PATH,
      store: new AgentPrefsStore(scratch()),
    });
    const status = await agents.status();
    expect(status.defaultId).toBe("claude");
  });
});

describe("the agents service", () => {
  it("stores a known harness and answers the new default", async () => {
    const store = new AgentPrefsStore(scratch());
    const agents = createAgentsService({
      accounts: fakeAgentAccounts(),
      env: NOTHING_ON_PATH,
      store,
    });
    const before = await agents.status();
    expect(before.defaultId).toBe("claude");
    const after = await agents.setDefault("codex");
    expect(after.defaultId).toBe("codex");
    expect(store.read()).toEqual({ defaultHarness: "codex" });
  });

  it("reports each vendor's own answer, and a runtime this copy lacks without asking it", async () => {
    const asked: string[] = [];
    const signedOut = fakeAgentAccounts({ claude: { state: "signed-out" } });
    const accounts: AgentAccounts = {
      ...signedOut,
      status: async (id) => {
        asked.push(id);
        return await signedOut.status(id);
      },
    };
    const agents = createAgentsService({
      accounts,
      env: { CODEX_PATH: "/nonexistent-dir/codex" },
      store: new AgentPrefsStore(scratch()),
    });
    const status = await agents.status();
    expect(status.harnesses).toEqual([
      {
        account: { state: "signed-out" },
        displayName: "Claude",
        id: "claude",
        runtime: "bundled",
        vendorApp: "Claude Code",
      },
      { displayName: "ChatGPT", id: "codex", runtime: "missing", vendorApp: "Codex" },
    ]);
    expect(asked).toEqual(["claude"]);
  });
});
