import { describe, expect, it } from "vitest";

import type { AiProviderSettings } from "@repo/features/ai-provider";

import { hasConnectedProvider } from "./ai-provider-store";

function settings(providers: { id: string; requiresAuth: boolean; connected: boolean }[]) {
  const first = providers[0];
  return {
    selected: { provider: first?.id ?? "none", modelId: "m" },
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

  it("any connected provider opens the gate, selected or not", () => {
    expect(
      hasConnectedProvider(
        settings([
          { id: "openai-codex", requiresAuth: true, connected: false },
          { id: "anthropic", requiresAuth: true, connected: true },
        ]),
      ),
    ).toBe(true);
  });

  it("an auth-free provider (faux) counts as connected — the guest faux path keeps AI on", () => {
    expect(
      hasConnectedProvider(settings([{ id: "faux", requiresAuth: false, connected: true }])),
    ).toBe(true);
  });
});
