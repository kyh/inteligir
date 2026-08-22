// Boot-time driver resolution: an absent codex binary must not crash the
// boot — it resolves to the unavailable driver, /system/status states why,
// and a send answers 503 with that same actionable message.

import { systemStatusResponseSchema } from "@repo/server-contract/routes";
import { describe, expect, it } from "vitest";
import { resolveAgentDriver } from "../agent-driver";
import { bootTestApp } from "../../__tests__/boot-app";
import { createThread } from "./agent-test-harness";
import { apiErrorResponseSchema } from "@repo/server-contract/errors";

describe("agent driver resolution", () => {
  it("binary-absent boot surfaces unavailable and 503s a send, without crashing", async () => {
    let resolvedDetail: string | null = null;
    const harness = await bootTestApp({
      agent: { mode: "codex", runtime: "unavailable", detail: "placeholder" },
      makeDriver: ({ db, bus, vault, vaultDir }) => {
        const resolved = resolveAgentDriver({
          config: { agent: "codex", agentModel: null, vaultDir },
          db,
          notifier: bus,
          vault,
          mcpServers: () => [],
          shellEnv: () => ({}),
          cliBinDir: null,
          connectedDirs: () => [],
          env: { PATH: "/nonexistent-dir" },
        });
        expect(resolved.status.runtime).toBe("unavailable");
        resolvedDetail = resolved.status.detail;
        return { createTurnDriver: resolved.createTurnDriver, dispose: resolved.dispose };
      },
    });
    expect(resolvedDetail).toContain("No agent CLI was found on PATH");

    const threadId = await createThread(harness.client);
    const send = await harness.client.threads.send.$post({
      json: { threadId, text: "hello", mode: "steer-if-active" },
    });
    expect(send.status).toBe(503);
    const body = apiErrorResponseSchema.parse(await send.json());
    expect(body.error).toBe("provider_unavailable");
    expect(body.message).toContain("No agent CLI was found on PATH");
  });

  it("the off mode reads as off on /system/status", async () => {
    const harness = await bootTestApp({
      agent: { mode: "off", runtime: "off", detail: "The agent is disabled (INTELIGIR_AGENT=off)" },
      makeDriver: ({ db, bus, vault, vaultDir }) => {
        const resolved = resolveAgentDriver({
          config: { agent: "off", agentModel: null, vaultDir },
          db,
          notifier: bus,
          vault,
          mcpServers: () => [],
          shellEnv: () => ({}),
          cliBinDir: null,
          connectedDirs: () => [],
        });
        return { createTurnDriver: resolved.createTurnDriver, dispose: resolved.dispose };
      },
    });
    const response = await harness.client.system.status.$get();
    expect(response.status).toBe(200);
    const status = systemStatusResponseSchema.parse(await response.json());
    expect(status.agent).toEqual({
      mode: "off",
      runtime: "off",
      detail: "The agent is disabled (INTELIGIR_AGENT=off)",
    });
  });
});
