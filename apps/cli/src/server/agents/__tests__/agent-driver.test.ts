import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";
import { systemStatusResponseSchema } from "@repo/api/local/system/system-schema";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { availableHarnesses, defaultHarnessId, resolveAgentDriver } from "../agent-driver";
import { bootTestApp, makeTempDir } from "../../__tests__/boot-app";
import { createThread, fakeSessionFacts } from "./agent-test-harness";

const NO_MODELS = { claude: null, codex: null };

describe("agent driver resolution", () => {
  it("with no CLI on PATH, answers unavailable and 503s a send, without crashing", async () => {
    const harness = await bootTestApp({
      agent: { detail: "placeholder", mode: "auto", runtime: "unavailable" },
      makeDriver: ({ db, bus, vault, vaultDir }) =>
        resolveAgentDriver({
          config: { agent: "auto", agentModels: NO_MODELS, vaultDir },
          db,
          env: { PATH: "/nonexistent-dir" },
          mcpServers: () => [],
          notifier: bus,
          sessionFacts: () => fakeSessionFacts(),
          vault,
        }),
    });
    const status = systemStatusResponseSchema.parse(await harness.client.system.status());
    expect(status.agent.runtime).toBe("unavailable");
    expect(status.agent.detail).toContain("No agent CLI was found on PATH");

    const threadId = await createThread(harness.client);
    const [refusal] = await safe(harness.client.threads.send({ text: "hello", threadId }));
    expect(isDefinedError(refusal) && refusal.code).toBe("PROVIDER_UNAVAILABLE");
    expect(refusal?.message).toContain("No agent CLI was found on PATH");
  });

  it("finds a CLI installed after boot on the next request, without a restart", async () => {
    const binDir = makeTempDir("inteligir-agent-path-");
    const env = { PATH: binDir };
    const harness = await bootTestApp({
      agent: { detail: "placeholder", mode: "auto", runtime: "unavailable" },
      makeDriver: ({ db, bus, vault, vaultDir }) =>
        resolveAgentDriver({
          config: { agent: "auto", agentModels: NO_MODELS, vaultDir },
          db,
          env,
          mcpServers: () => [],
          notifier: bus,
          sessionFacts: () => fakeSessionFacts(),
          vault,
        }),
    });
    const before = systemStatusResponseSchema.parse(await harness.client.system.status());
    expect(before.agent.runtime).toBe("unavailable");
    expect(defaultHarnessId(null, env)).toBe("claude");

    const codex = path.join(binDir, "codex");
    writeFileSync(codex, "#!/bin/sh\n");
    chmodSync(codex, 0o755);

    const after = systemStatusResponseSchema.parse(await harness.client.system.status());
    expect(after.agent).toEqual({ detail: null, mode: "auto", runtime: "acp" });
    expect(availableHarnesses(env)).toEqual(["codex"]);
    expect(defaultHarnessId(null, env)).toBe("codex");
  });

  it("the off mode reads as off on /system/status", async () => {
    const harness = await bootTestApp({
      agent: { detail: "The agent is disabled (INTELIGIR_AGENT=off)", mode: "off", runtime: "off" },
      makeDriver: ({ db, bus, vault, vaultDir }) =>
        resolveAgentDriver({
          config: { agent: "off", agentModels: NO_MODELS, vaultDir },
          db,
          mcpServers: () => [],
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
