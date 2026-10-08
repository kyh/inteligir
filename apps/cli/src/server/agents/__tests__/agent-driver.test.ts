import { isDefinedError, safe } from "@orpc/client";
import { systemStatusResponseSchema } from "@repo/contract/local/system/system-schema";
import type { AgentMode } from "@repo/contract/local/system/system-schema";
import { describe, expect, it } from "vitest";
import { NO_AGENT_RUNTIME, resolveAgentDriver } from "../agent-driver";
import { bootTestApp } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";

// `agent` sets the config's mode; the status a client reads is the resolved driver's own.
const bootIn = async (agent: AgentMode): Promise<BootedTestApp> =>
  await bootTestApp({
    agent: { detail: null, mode: agent, runtime: "off" },
    makeDriver: ({ bus, db }) => resolveAgentDriver({ config: { agent }, db, notifier: bus }),
  });

const refusalOfSend = async (harness: BootedTestApp) => {
  const { thread } = await harness.client.threads.create({});
  const [refusal] = await safe(harness.client.threads.send({ text: "hello", threadId: thread.id }));
  return isDefinedError(refusal) ? { code: refusal.code, message: refusal.message } : null;
};

describe("agent driver resolution", () => {
  it("has no runtime to run a turn on by default, and refuses a send in those words", async () => {
    const harness = await bootIn("auto");
    const status = systemStatusResponseSchema.parse(await harness.client.system.status());
    expect(status.agent).toEqual({
      detail: NO_AGENT_RUNTIME,
      mode: "auto",
      runtime: "unavailable",
    });
    expect(await refusalOfSend(harness)).toEqual({
      code: "PROVIDER_UNAVAILABLE",
      message: NO_AGENT_RUNTIME,
    });
  });

  it("the off mode reads as off, and refuses a send", async () => {
    const harness = await bootIn("off");
    const status = systemStatusResponseSchema.parse(await harness.client.system.status());
    const detail = "The agent is disabled (INTELIGIR_AGENT=off)";
    expect(status.agent).toEqual({ detail, mode: "off", runtime: "off" });
    expect(await refusalOfSend(harness)).toEqual({ code: "PROVIDER_UNAVAILABLE", message: detail });
  });

  it("the scripted mode runs a turn", async () => {
    const harness = await bootIn("scripted");
    const status = systemStatusResponseSchema.parse(await harness.client.system.status());
    expect(status.agent).toEqual({ detail: null, mode: "scripted", runtime: "scripted" });
    expect(await refusalOfSend(harness)).toBeNull();
  });
});
