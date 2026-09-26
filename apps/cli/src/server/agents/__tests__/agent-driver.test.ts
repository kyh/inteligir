import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import type { AcpAgentRuntimeOptions } from "@repo/agent-runtime/acp/acp-runtime";
import { systemStatusResponseSchema } from "@repo/api/local/system/system-schema";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { defaultHarnessId, resolveAgentDriver } from "../agent-driver";
import { bootTestApp, fakeAgentAccounts, makeTempDir } from "../../__tests__/boot-app";
import {
  awaitThreadStatus,
  createThread,
  fakeSessionFacts,
  fetchTimelineRows,
  flattenTimelineRows,
  sendMessage,
} from "./agent-test-harness";

const require = createRequire(import.meta.url);
const FAKE_AGENT = require.resolve("@repo/agent-runtime/test-support/fake-acp-agent");

const NO_MODELS = { claude: null, codex: null };

// the fake stands in for the adapter, so no turn here reaches a vendor or spends a model call.
const spawnFakeAdapter: AcpAgentRuntimeOptions["spawnAdapter"] = (_harness, env) => ({
  child: spawn(process.execPath, [FAKE_AGENT], {
    env: { ...env, FAKE_ACP_MODE: "message" },
    stdio: ["pipe", "pipe", "pipe"],
  }),
});

const bootAuto = async (env: NodeJS.ProcessEnv) =>
  await bootTestApp({
    agent: { detail: "placeholder", mode: "auto", runtime: "unavailable" },
    makeDriver: ({ db, bus, vault, vaultDir }) =>
      resolveAgentDriver({
        accounts: fakeAgentAccounts(),
        config: { agent: "auto", agentModels: NO_MODELS, vaultDir },
        db,
        env,
        notifier: bus,
        sessionFacts: () => fakeSessionFacts(),
        spawnAdapter: spawnFakeAdapter,
        vault,
      }),
  });

describe("agent driver resolution", () => {
  it("runs on the bundled runtime with nothing on PATH, and a send is not refused", async () => {
    const harness = await bootAuto({ PATH: "/nonexistent-dir" });
    const status = systemStatusResponseSchema.parse(await harness.client.system.status());
    expect(status.agent).toEqual({ detail: null, mode: "auto", runtime: "acp" });

    const threadId = await createThread(harness.client);
    const turnId = await sendMessage(harness.client, threadId, "hello");
    await awaitThreadStatus(harness.client, threadId, "idle");
    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    expect(
      rows.find((row) => row.kind === "conversation" && row.role === "assistant"),
    ).toMatchObject({ text: "hello from the fake agent", turnId });
  });

  it("refuses a send when the runtime the thread runs on is missing, and says to reinstall", async () => {
    const missing = path.join(makeTempDir("inteligir-agent-runtime-"), "claude");
    const harness = await bootAuto({ CLAUDE_CODE_EXECUTABLE: missing });
    const reinstall = "This copy of inteligir is missing its Claude runtime — reinstall it";
    const status = systemStatusResponseSchema.parse(await harness.client.system.status());
    expect(status.agent).toEqual({ detail: reinstall, mode: "auto", runtime: "unavailable" });

    const threadId = await createThread(harness.client);
    const [refusal] = await safe(harness.client.threads.send({ text: "hello", threadId }));
    expect(isDefinedError(refusal) && refusal.code).toBe("PROVIDER_UNAVAILABLE");
    expect(refusal?.message).toBe(reinstall);
  });

  it("starts a new thread on claude with nothing chosen, whatever PATH holds", () => {
    expect(defaultHarnessId(null)).toBe("claude");
    expect(defaultHarnessId("codex")).toBe("codex");
  });

  it("the off mode reads as off on /system/status", async () => {
    const harness = await bootTestApp({
      agent: { detail: "The agent is disabled (INTELIGIR_AGENT=off)", mode: "off", runtime: "off" },
      makeDriver: ({ db, bus, vault, vaultDir }) =>
        resolveAgentDriver({
          accounts: fakeAgentAccounts(),
          config: { agent: "off", agentModels: NO_MODELS, vaultDir },
          db,
          notifier: bus,
          sessionFacts: () => fakeSessionFacts(),
          vault,
        }),
    });
    const status = systemStatusResponseSchema.parse(await harness.client.system.status());
    expect(status.agent).toEqual({
      detail: "The agent is disabled (INTELIGIR_AGENT=off)",
      mode: "off",
      runtime: "off",
    });
  });
});
