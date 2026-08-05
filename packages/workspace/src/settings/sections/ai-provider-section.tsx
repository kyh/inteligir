import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@repo/bridge/client";
import { useAiProviderStore } from "@repo/editor/stores/ai-provider-store";

// AI provider — pick which provider+model the agent runs on, and manage the
// per-provider connection (pi's interactive OAuth; tokens stay on-device).
// Everything renders from the shared ai-provider-store snapshot: every
// mutating call routes through the store so the composer's connect affordance
// and the editor-AI gates update in the same frame. Switching applies to the
// next reply — the host rolls the live sessions, no app restart. Disconnect
// touches ONLY this provider's credentials (pi auth.json) — the app stays in
// the workspace as a guest and the sync account is untouched.
export function AiProviderSection() {
  const settings = useAiProviderStore((s) => s.settings);
  const init = useAiProviderStore((s) => s.init);
  const refresh = useAiProviderStore((s) => s.refresh);
  const setConfig = useAiProviderStore((s) => s.setConfig);
  const connect = useAiProviderStore((s) => s.connect);
  const disconnect = useAiProviderStore((s) => s.disconnect);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  const selected = settings?.providers.find((p) => p.id === settings.selected.provider) ?? null;

  const patchConfig = useCallback(
    async (patch: { provider?: string; modelId?: string }) => {
      setBusy(true);
      setError(null);
      try {
        await setConfig(patch);
      } catch {
        setError("Failed to update the AI provider.");
      } finally {
        setBusy(false);
      }
    },
    [setConfig],
  );

  const handleConnect = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await connect(selected.id);
      if (!result.ok) setError(result.error);
    } catch {
      setError("Failed to connect.");
    } finally {
      setBusy(false);
    }
  }, [selected, connect]);

  const handleDisconnect = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await disconnect(selected.id);
    } catch {
      setError("Failed to disconnect.");
    } finally {
      setBusy(false);
    }
  }, [selected, disconnect]);

  // Re-run the OAuth flow for the SELECTED provider + roll a fresh session
  // (the existing agent:reauthenticate path — for expired credentials, which
  // still read as "Connected" until a turn fails).
  const handleReauthenticate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await getBridge().reauthenticate();
      if (!result.ok) setError(result.error);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">AI Provider</Label>
      <div className="rounded-[10px] bg-muted">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <label htmlFor="ai-provider-select" className="text-xs text-foreground">
            Provider
          </label>
          {/* Native selects: a portaled Base UI menu popup inside the settings
              Dialog reads as an outside press and dismisses it. */}
          <select
            id="ai-provider-select"
            value={settings?.selected.provider ?? ""}
            onChange={(e) => void patchConfig({ provider: e.target.value })}
            disabled={settings === null || busy}
            className="h-6 max-w-[55%] rounded-md bg-card px-1.5 text-[10px] font-medium text-muted-foreground shadow-surface-2 outline-none transition-colors hover:text-foreground"
          >
            {settings?.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 pb-2">
          <label htmlFor="ai-provider-model-select" className="text-xs text-foreground">
            Model
          </label>
          <select
            id="ai-provider-model-select"
            value={settings?.selected.modelId ?? ""}
            onChange={(e) => void patchConfig({ modelId: e.target.value })}
            disabled={settings === null || busy}
            className="h-6 max-w-[55%] rounded-md bg-card px-1.5 text-[10px] font-medium text-muted-foreground shadow-surface-2 outline-none transition-colors hover:text-foreground"
          >
            {selected?.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.id === selected.defaultModelId ? " (default)" : ""}
              </option>
            ))}
          </select>
        </div>
        {selected && (
          <div className="flex items-center justify-between border-t border-border/50 px-3 py-2">
            <span className="text-xs text-foreground">
              {selected.requiresAuth
                ? selected.connected
                  ? "Connected"
                  : "Not connected"
                : "No login needed"}
            </span>
            {selected.requiresAuth && (
              <div className="flex items-center gap-1">
                {selected.connected ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleReauthenticate()}
                      disabled={busy}
                      className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {busy ? "Opening…" : "Re-authenticate"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDisconnect()}
                      disabled={busy}
                      className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleConnect()}
                    disabled={busy}
                    className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {busy ? "Opening…" : "Connect"}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {error && <p className="px-3 pb-2 text-[10px] text-destructive">{error}</p>}
        <p className="px-3 pb-2 text-[10px] text-muted-foreground">
          Switching applies to the next reply. Provider tokens stay on this device.
        </p>
      </div>
    </div>
  );
}
