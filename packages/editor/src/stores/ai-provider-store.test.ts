import { describe, expect, it, vi } from "vitest";

import type { AiProviderSettings } from "@repo/bridge/ai-provider";

// The store reaches the host only through getBridge(); stub it so init() is
// testable without a transport (same pattern as agent-gateway.test.ts).
const { getBridge } = vi.hoisted(() => ({ getBridge: vi.fn() }));
vi.mock("@repo/bridge/client", () => ({ getBridge }));

import { hasConnectedProvider, useAiProviderStore } from "./ai-provider-store";

function settings(
  providers: { id: string; requiresAuth: boolean; connected: boolean }[],
  selected?: string,
) {
  const first = providers[0];
  return {
    selected: { provider: selected ?? first?.id ?? "none", modelId: "m" },
    providers: providers.map((p) => ({
      ...p,
      label: p.id,
      defaultModelId: "m",
      models: [{ id: "m", label: "M" }],
    })),
  } satisfies AiProviderSettings;
}

describe("hasConnectedProvider — the AI feature gate (#459)", () => {
  it("fails OPEN pre-load (null) so the connect affordance never flashes at boot", () => {
    expect(hasConnectedProvider(null)).toBe(true);
  });

  it("no provider connected → gate closed", () => {
    expect(
      hasConnectedProvider(
        settings([
          { id: "openai-codex", requiresAuth: true, connected: false },
          { id: "anthropic", requiresAuth: true, connected: false },
        ]),
      ),
    ).toBe(false);
  });

  it("a connected NON-selected provider does NOT open the gate — turns run the SELECTED one", () => {
    expect(
      hasConnectedProvider(
        settings(
          [
            { id: "openai-codex", requiresAuth: true, connected: false },
            { id: "anthropic", requiresAuth: true, connected: true },
          ],
          "openai-codex",
        ),
      ),
    ).toBe(false);
  });

  it("the SELECTED provider connected → gate open (other providers irrelevant)", () => {
    expect(
      hasConnectedProvider(
        settings(
          [
            { id: "openai-codex", requiresAuth: true, connected: false },
            { id: "anthropic", requiresAuth: true, connected: true },
          ],
          "anthropic",
        ),
      ),
    ).toBe(true);
  });

  it("a selection pointing at no known provider → gate closed (no phantom open)", () => {
    expect(
      hasConnectedProvider(
        settings([{ id: "openai-codex", requiresAuth: true, connected: true }], "gone"),
      ),
    ).toBe(false);
  });

  it("an auth-free provider (faux) counts as connected — the guest faux path keeps AI on", () => {
    expect(
      hasConnectedProvider(settings([{ id: "faux", requiresAuth: false, connected: true }])),
    ).toBe(true);
  });
});

describe("useAiProviderStore.init — a transient fetch failure must not latch forever", () => {
  it("un-latches on failure so a later init() retries, then latches on success", async () => {
    const fetchSettings = vi.fn();
    getBridge.mockReturnValue({ getAiProviderSettings: fetchSettings });

    // First load rejects (transient WS hiccup) — settings stay null.
    fetchSettings.mockRejectedValueOnce(new Error("ws hiccup"));
    await useAiProviderStore.getState().init();
    expect(useAiProviderStore.getState().settings).toBeNull();

    // A later init() (another consumer mounting) retries and succeeds.
    const snapshot = settings([{ id: "openai-codex", requiresAuth: true, connected: true }]);
    fetchSettings.mockResolvedValue(snapshot);
    await useAiProviderStore.getState().init();
    expect(useAiProviderStore.getState().settings).toEqual(snapshot);

    // Latched on SUCCESS: further init()s stay no-ops.
    await useAiProviderStore.getState().init();
    expect(fetchSettings).toHaveBeenCalledTimes(2);
  });
});
