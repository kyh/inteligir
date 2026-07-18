import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@renderer/lib/bridge";
import { SettingSwitchRow } from "@renderer/settings/sections/setting-switch-row";
import type { PairingInfo, RemoteAccessState } from "@repo/features/remote-access";

// Remote access — let other devices (the mobile companion) connect to this
// computer's ws transport. The host owns everything: the enable toggle flips
// the server's bind address, devices live in the paired-device store, and
// pairing tokens are minted host-side. The onRemoteAccessChanged subscription
// keeps this reactive across config/device/listen changes. Pairing info is
// kept local (transient) — it's a one-time secret shown once, not state.
export function RemoteAccessSection() {
  const [state, setState] = useState<RemoteAccessState | null>(null);
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    void bridge
      .getRemoteAccessState()
      .then(setState)
      .catch(() => {});
    return bridge.onRemoteAccessChanged(setState);
  }, []);

  const handleToggle = useCallback(async (next: boolean) => {
    const bridge = getBridge();
    setError(null);
    if (!next) setPairing(null);
    try {
      const updated = await bridge.setRemoteAccessConfig({ enabled: next });
      setState(updated);
    } catch {
      setError("Failed to update remote access.");
    }
  }, []);

  const handlePair = useCallback(async () => {
    const bridge = getBridge();
    setBusy(true);
    setError(null);
    try {
      setPairing(await bridge.createPairingToken());
    } catch {
      setError("Failed to create a pairing code.");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleRevoke = useCallback(async (id: string) => {
    const bridge = getBridge();
    setBusy(true);
    setError(null);
    try {
      const next = await bridge.revokeRemoteDevice({ id });
      setState(next);
    } catch {
      setError("Failed to revoke the device.");
    } finally {
      setBusy(false);
    }
  }, []);

  const loading = state === null;
  const enabled = state?.enabled === true;
  const lanUrls = state?.lanUrls ?? [];
  const devices = state?.devices ?? [];

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Remote access</Label>
      <div className="rounded-[12px] bg-muted">
        <SettingSwitchRow
          label="Allow other devices"
          checked={enabled}
          onToggle={() => void handleToggle(!enabled)}
          disabled={loading}
        />
        <div className="flex flex-col gap-2 px-3 pb-2">
          <p className="text-[10px] text-muted-foreground">
            Let paired devices on your local network connect to this computer. Off keeps the app
            reachable from this computer only.
          </p>
          <p className="text-[10px] text-muted-foreground">
            Connections on your local network are unencrypted. Pair devices only on networks you
            trust.
          </p>

          {enabled && (
            <>
              {lanUrls.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">
                    This computer on your network
                  </span>
                  {lanUrls.map((url) => (
                    <code
                      key={url}
                      className="select-all rounded-[8px] bg-card px-2.5 py-1.5 text-[10px] text-foreground"
                    >
                      {url}
                    </code>
                  ))}
                </div>
              )}

              {devices.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Paired devices</span>
                  {devices.map((device) => (
                    <div
                      key={device.id}
                      className="flex items-center justify-between gap-2 rounded-[8px] bg-card px-2.5 py-1.5"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-xs text-foreground">{device.name}</span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          Last seen {new Date(device.lastSeenAt).toLocaleString()}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRevoke(device.id)}
                        disabled={busy}
                        className="h-auto shrink-0 px-2 py-0.5 text-[10px] text-muted-foreground"
                      >
                        Revoke
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-1.5 border-t border-border pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handlePair()}
                  disabled={busy || loading}
                  className="h-7 self-start px-3 text-[10px]"
                >
                  {busy ? "Working…" : "Pair a device"}
                </Button>
                {pairing && (
                  <div className="flex flex-col gap-1 rounded-[8px] bg-card px-2.5 py-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      On the other device, connect to{" "}
                      <code className="select-all text-foreground">
                        {pairing.urls.join(" or ")}
                      </code>{" "}
                      and enter this one-time code:
                    </span>
                    <code className="select-all text-xs text-foreground">{pairing.token}</code>
                    <span className="text-[10px] text-muted-foreground">
                      Expires{" "}
                      {new Date(pairing.expiresAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      . Single use.
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {error && <span className="text-[10px] text-destructive">{error}</span>}
        </div>
      </div>
    </div>
  );
}
