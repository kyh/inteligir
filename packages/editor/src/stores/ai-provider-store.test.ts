import { beforeEach, describe, expect, it, vi } from "vitest";

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

// The bridge the whole file drives. `push` is the host's onAiProviderChanged —
// captured at subscribe time, because the store subscribes once and keeps it
// (the snapshot is app-wide and outlives every component reading it).
const fetchSettings = vi.fn();
const connectAiProvider = vi.fn();
const disconnectAiProvider = vi.fn();
let push: (settings: AiProviderSettings) => void = () => {};

const bridge = {
  getAiProviderSettings: fetchSettings,
  connectAiProvider,
  disconnectAiProvider,
  onAiProviderChanged: (listener: (settings: AiProviderSettings) => void) => {
    push = listener;
    return () => {};
  },
};

describe("useAiProviderStore.init — a transient fetch failure must not latch forever", () => {
  it("un-latches on failure so a later init() retries, then latches on success", async () => {
    getBridge.mockReturnValue(bridge);

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

// Ending a session and starting another happens in ONE document now, so the
// store's two module-level latches have to clear together. `subscribed` is the
// subtle one: the push handler was installed on the previous BRIDGE, which the
// sign-out disposed along with the subscription — so a latch that survived
// would mean the next session never subscribes at all, and the push is the only
// thing that settles an `awaiting` connect.
describe("useAiProviderStore.reset — the next session must re-subscribe", () => {
  it("clears both latches, so a later init() fetches AND subscribes again", async () => {
    let subscriptions = 0;
    const freshBridge = {
      ...bridge,
      onAiProviderChanged: (listener: (settings: AiProviderSettings) => void) => {
        subscriptions += 1;
        push = listener;
        return () => {};
      },
    };
    getBridge.mockReturnValue(freshBridge);
    // The latches are MODULE state, so an earlier test in this file may hold
    // them. Starting from a reset is both the honest baseline and the first
    // half of what is under test.
    useAiProviderStore.getState().reset();

    const first = settings([{ id: "openai-codex", requiresAuth: true, connected: true }]);
    fetchSettings.mockResolvedValue(first);
    await useAiProviderStore.getState().init();
    expect(subscriptions).toBe(1);

    useAiProviderStore.getState().reset();
    expect(useAiProviderStore.getState().settings).toBeNull();

    // The next session's bridge is a DIFFERENT object with no subscribers.
    const second = settings([{ id: "anthropic", requiresAuth: true, connected: true }]);
    fetchSettings.mockResolvedValue(second);
    await useAiProviderStore.getState().init();

    expect(useAiProviderStore.getState().settings).toEqual(second);
    expect(subscriptions, "the second session never subscribed to onAiProviderChanged").toBe(2);

    // And the handler it installed is live: a push settles state as it should.
    const pushed = settings([{ id: "anthropic", requiresAuth: true, connected: false }]);
    push(pushed);
    expect(useAiProviderStore.getState().settings).toEqual(pushed);
  });
});

// The connect flow is the one that spans two tabs: this store starts it, a
// browser leaves for the provider, and the host finishes it on its own callback
// and pushes a snapshot back. Nothing here can be observed by awaiting the
// call — the assertion is the STATE the surfaces render from.
describe("useAiProviderStore.startConnect — the two-tab OAuth flow", () => {
  const disconnected = settings([{ id: "anthropic", requiresAuth: true, connected: false }]);
  const connected = settings([{ id: "anthropic", requiresAuth: true, connected: true }]);
  const open = vi.fn();

  beforeEach(() => {
    open.mockClear();
    vi.stubGlobal("window", { open });
    getBridge.mockReturnValue(bridge);
    useAiProviderStore.setState({ settings: disconnected, connect: { phase: "idle" } });
  });

  it("sends the user to the consent page and waits, holding the URL", async () => {
    connectAiProvider.mockResolvedValue({
      ok: true,
      authorizeUrl: "https://provider.test/auth?x=1",
    });

    await useAiProviderStore.getState().startConnect("anthropic");

    // A new tab, and no opener handle — so a surface can only offer the URL as
    // a link, which is also the way through a blocked popup.
    expect(open).toHaveBeenCalledWith(
      "https://provider.test/auth?x=1",
      "_blank",
      "noopener,noreferrer",
    );
    expect(useAiProviderStore.getState().connect).toEqual({
      phase: "awaiting",
      provider: "anthropic",
      authorizeUrl: "https://provider.test/auth?x=1",
    });
  });

  it("settles on the host's push — the connect never resolves into one", async () => {
    connectAiProvider.mockResolvedValue({ ok: true, authorizeUrl: "https://provider.test/auth" });
    await useAiProviderStore.getState().startConnect("anthropic");

    push(connected);

    expect(useAiProviderStore.getState().connect).toEqual({ phase: "idle" });
    expect(useAiProviderStore.getState().settings).toEqual(connected);
  });

  it("reads a snapshot that is still disconnected as a refused sign-in", async () => {
    connectAiProvider.mockResolvedValue({ ok: true, authorizeUrl: "https://provider.test/auth" });
    await useAiProviderStore.getState().startConnect("anthropic");

    // What the host pushes after a declined consent: the attempt is over and
    // the provider is not connected. Waiting forever is the failure this ends.
    push(disconnected);

    expect(useAiProviderStore.getState().connect).toEqual({
      phase: "failed",
      provider: "anthropic",
      error: expect.stringContaining("cancelled or refused"),
    });
  });

  it("surfaces the host's refusal and opens nothing", async () => {
    connectAiProvider.mockResolvedValue({
      ok: false,
      error: "Claude is not configured on this deployment.",
    });

    await useAiProviderStore.getState().startConnect("anthropic");

    expect(open).not.toHaveBeenCalled();
    expect(useAiProviderStore.getState().connect).toEqual({
      phase: "failed",
      provider: "anthropic",
      error: "Claude is not configured on this deployment.",
    });
  });

  it("surfaces a host it could not reach at all", async () => {
    connectAiProvider.mockRejectedValue(new Error("socket closed"));

    await useAiProviderStore.getState().startConnect("anthropic");

    expect(useAiProviderStore.getState().connect).toMatchObject({ phase: "failed" });
  });

  it("lets the user give up, and ends the wait when they disconnect instead", async () => {
    connectAiProvider.mockResolvedValue({ ok: true, authorizeUrl: "https://provider.test/auth" });
    await useAiProviderStore.getState().startConnect("anthropic");
    useAiProviderStore.getState().dismissConnect();
    expect(useAiProviderStore.getState().connect).toEqual({ phase: "idle" });

    await useAiProviderStore.getState().startConnect("anthropic");
    disconnectAiProvider.mockResolvedValue(disconnected);
    await useAiProviderStore.getState().disconnect("anthropic");
    expect(useAiProviderStore.getState().connect).toEqual({ phase: "idle" });
  });

  it("ignores a push that lands with no attempt in flight", () => {
    push(connected);
    expect(useAiProviderStore.getState().connect).toEqual({ phase: "idle" });
    expect(useAiProviderStore.getState().settings).toEqual(connected);
  });
});
