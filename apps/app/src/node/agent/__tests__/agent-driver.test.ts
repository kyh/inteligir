// Boot-time driver resolution: an absent codex binary must not crash the
// boot — it resolves to the unavailable driver, /system/status states why,
// and a send answers 503 with that same actionable message.

import { systemStatusResponseSchema } from "@repo/server-contract/routes";
import { describe, expect, it } from "vitest";
import { codexBinaryOnPath, resolveAgentDriver } from "../agent-driver";
import { bootTestApp } from "../../__tests__/boot-app";
import { createThread } from "./agent-test-harness";

describe("agent driver resolution", () => {
  it("finds no codex on an empty PATH", () => {
    expect(codexBinaryOnPath({ PATH: "/nonexistent-dir" })).toBeNull();
  });

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
          env: { PATH: "/nonexistent-dir" },
        });
        expect(resolved.status.runtime).toBe("unavailable");
        resolvedDetail = resolved.status.detail;
        return { createTurnDriver: resolved.createTurnDriver, dispose: resolved.dispose };
      },
    });
    expect(resolvedDetail).toContain("codex binary was not found");

    const threadId = await createThread(harness.client);
    const send = await harness.client.threads.send.$post({
      json: { threadId, text: "hello", mode: "steer-if-active" },
    });
    expect(send.status).toBe(503);
    const body = (await send.json()) as { error: string; message: string };
    expect(body.error).toBe("provider_unavailable");
    expect(body.message).toContain("codex binary was not found");
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
