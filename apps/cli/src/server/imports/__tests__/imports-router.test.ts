// the import's routes as an agent's shell reaches them: it may plan an import, never start one,
// since the job's batches land after its turn, where the turn's Undo changes cannot reach them.

import { createRouterClient, isDefinedError, safe } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { bootTestApp } from "../../__tests__/boot-app";
import { localRouter } from "../../root-router";

const CSV = new TextEncoder().encode(
  "title,url,folder\nFile over app,https://stephango.com/file-over-app,Reading\n",
);

describe("an import from an agent's shell", () => {
  it("plans, but is refused the start, and leaves no job behind", async () => {
    const harness = await bootTestApp();
    const agent = createRouterClient(localRouter, {
      context: { ...harness.composed.context, agentThreadId: "thr_agent" },
    });
    const plan = await agent.imports.plan({ file: new Blob([CSV]), source: "raindrop" });
    expect(plan.items).toBe(1);

    const [refused] = await safe(agent.imports.start({ planId: plan.planId }));
    expect(isDefinedError(refused) && refused.code).toBe("FORBIDDEN");
    expect(refused?.message).toContain("Import from Raindrop…");
    expect(await harness.client.imports.status()).toEqual({ job: null });
  });
});
