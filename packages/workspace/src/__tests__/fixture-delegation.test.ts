// The fixture bridge's simulated delegation lifecycle must be REALLY
// cancelable: the client's delegation-store fires cancelDelegation
// fire-and-forget and swallows rejections (.catch(() => {})), so a throwing
// stub — or a canned { ok: false } — is byte-identical to silent failure in
// the harness UI. Cancel has to pull the pending simulated run and flip the
// record the way the host manager does (status "failed", error "Stopped.").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeStore } from "@repo/notes/knowledge/knowledge-store";

import { createFixtureBridge } from "@repo/workspace/dev/fixture-bridge";

/** Minimal in-memory KnowledgeStore — the delegation channels never search,
 * so a no-op store keeps this test off the wasm-sqlite dependency. */
function memoryKnowledgeStore(): KnowledgeStore {
  return {
    loadAll: () => ({ docs: [], others: [] }),
    upsertDoc: () => {},
    upsertOther: () => {},
    remove: () => {},
    clear: () => {},
    search: () => [],
    transaction: (fn) => fn(),
    nuke: () => {},
    dispose: () => {},
  };
}

const newBridge = () => createFixtureBridge(() => memoryKnowledgeStore());

// tasks.md's first unchecked box ("Review the replatform plan") is ordinal 0.
const SOURCE = "tasks.md";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fixture bridge delegation cancel", () => {
  it("cancel during the simulated run really cancels — no edit lands", async () => {
    const bridge = newBridge();
    const before = await bridge.readVaultFile({ path: SOURCE });

    const created = await bridge.createDelegation({ sourceFile: SOURCE, ordinal: 0 });
    if (!created.ok) throw new Error("fixture delegation refused");
    expect(created.delegation.status).toBe("running");

    await expect(bridge.cancelDelegation(created.delegation.id)).resolves.toEqual({ ok: true });
    const afterCancel = (await bridge.listDelegations()).delegations.find(
      (d) => d.id === created.delegation.id,
    );
    expect(afterCancel?.status).toBe("failed");
    expect(afterCancel?.error).toBe("Stopped.");

    // The simulated agent edit was scheduled for +800ms — a real cancel means
    // it never lands, even after the timer horizon passes.
    vi.advanceTimersByTime(2000);
    expect(await bridge.readVaultFile({ path: SOURCE })).toBe(before);
    const settled = (await bridge.listDelegations()).delegations.find(
      (d) => d.id === created.delegation.id,
    );
    expect(settled?.status).toBe("failed");
  });

  it("a finished run can't be pulled back (host parity), and the run edits when NOT canceled", async () => {
    const bridge = newBridge();
    const before = await bridge.readVaultFile({ path: SOURCE });

    const created = await bridge.createDelegation({ sourceFile: SOURCE, ordinal: 0 });
    if (!created.ok) throw new Error("fixture delegation refused");
    vi.advanceTimersByTime(2000); // let the simulated run finish

    const done = (await bridge.listDelegations()).delegations.find(
      (d) => d.id === created.delegation.id,
    );
    expect(done?.status).toBe("done");
    expect(await bridge.readVaultFile({ path: SOURCE })).not.toBe(before);

    await expect(bridge.cancelDelegation(created.delegation.id)).resolves.toEqual({ ok: false });
    await expect(bridge.cancelDelegation("no-such-id")).resolves.toEqual({ ok: false });
  });
});
