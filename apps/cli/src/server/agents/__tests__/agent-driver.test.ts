import { systemStatusResponseSchema } from "@repo/api/local/system/system-schema";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { resolveAgentDriver } from "../agent-driver";
import { bootTestApp } from "../../__tests__/boot-app";
import { createThread, fakeSessionFacts } from "./agent-test-harness";

describe("agent driver resolution", () => {
  it("binary-absent boot surfaces unavailable and 503s a send, without crashing", async () => {
    let resolvedDetail: string | null = null;
    const harness = await bootTestApp({
      agent: { detail: "placeholder", mode: "auto", runtime: "unavailable" },
      makeDriver: ({ db, bus, vault, vaultDir }) => {
        const resolved = resolveAgentDriver({
          config: { agent: "auto", agentModel: null, vaultDir },
          db,
          env: { PATH: "/nonexistent-dir" },
          mcpServers: () => [],
          notifier: bus,
          sessionFacts: () => fakeSessionFacts(),
          vault,
        });
        expect(resolved.status.runtime).toBe("unavailable");
        resolvedDetail = resolved.status.detail;
        return { createTurnDriver: resolved.createTurnDriver, dispose: resolved.dispose };
      },
    });
    expect(resolvedDetail).toContain("No agent CLI was found on PATH");

    const threadId = await createThread(harness.client);
    const [refusal] = await safe(harness.client.threads.send({ text: "hello", threadId }));
    expect(isDefinedError(refusal) && refusal.code).toBe("PROVIDER_UNAVAILABLE");
    expect(refusal?.message).toContain("No agent CLI was found on PATH");
  });

  it("the off mode reads as off on /system/status", async () => {
    const harness = await bootTestApp({
      agent: { detail: "The agent is disabled (INTELIGIR_AGENT=off)", mode: "off", runtime: "off" },
      makeDriver: ({ db, bus, vault, vaultDir }) => {
        const resolved = resolveAgentDriver({
          config: { agent: "off", agentModel: null, vaultDir },
          db,
          mcpServers: () => [],
          notifier: bus,
          sessionFacts: () => fakeSessionFacts(),
          vault,
        });
        return { createTurnDriver: resolved.createTurnDriver, dispose: resolved.dispose };
      },
    });
    const status = systemStatusResponseSchema.parse(await harness.client.system.status());
    expect(status.agent).toEqual({
      detail: "The agent is disabled (INTELIGIR_AGENT=off)",
      mode: "off",
      runtime: "off",
    });
  });
});
