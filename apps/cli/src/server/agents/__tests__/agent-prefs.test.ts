import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHarnessId } from "@repo/agent-runtime/acp/harness-registry";
import { afterEach, describe, expect, it } from "vitest";

import { defaultHarnessId } from "../agent-driver";
import { AgentPrefsStore } from "../agent-prefs-store";
import { JsonFileStoreError } from "../../json-file-store";
import { createAgentsService, UnknownHarnessError } from "../agents-service";
import type { VendorAccounts } from "../vendor-accounts";
import { fakeVendorAccounts } from "../../__tests__/boot-app";

const NOTHING_ON_PATH = { PATH: "/nonexistent-dir" };
const dirs: string[] = [];

const scratch = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-prefs-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
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
    expect(defaultHarnessId("codex")).toBe("codex");
  });

  it("falls back to claude with nothing chosen, whatever PATH holds", async () => {
    expect(defaultHarnessId(null)).toBe("claude");
    const agents = createAgentsService({
      accounts: fakeVendorAccounts(),
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
      accounts: fakeVendorAccounts(),
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
    const signedOut = fakeVendorAccounts({ claude: { state: "signed-out" } });
    const accounts: VendorAccounts = {
      invalidate: signedOut.invalidate,
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
      { account: { state: "signed-out" }, displayName: "Claude", id: "claude", runtime: "bundled" },
      { displayName: "ChatGPT", id: "codex", runtime: "missing" },
    ]);
    expect(asked).toEqual(["claude"]);
  });

  it("refuses an unknown harness without writing", async () => {
    const store = new AgentPrefsStore(scratch());
    const agents = createAgentsService({
      accounts: fakeVendorAccounts(),
      env: NOTHING_ON_PATH,
      store,
    });
    await expect(agents.setDefault("gemini")).rejects.toThrow(UnknownHarnessError);
    expect(store.read()).toEqual({});
  });

  it("refuses a name every object answers to", async () => {
    const store = new AgentPrefsStore(scratch());
    const agents = createAgentsService({
      accounts: fakeVendorAccounts(),
      env: NOTHING_ON_PATH,
      store,
    });
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(isHarnessId(name)).toBe(false);
      await expect(agents.setDefault(name)).rejects.toThrow(UnknownHarnessError);
    }
    expect(store.read()).toEqual({});
  });
});
