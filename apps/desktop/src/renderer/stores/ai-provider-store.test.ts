import { describe, expect, it } from "vitest";

import type { AiProviderSettings } from "@repo/features/ai-provider";

import { hasConnectedProvider } from "./ai-provider-store";

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
