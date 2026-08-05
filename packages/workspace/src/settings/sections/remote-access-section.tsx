import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@repo/ui/components/native-select";

import { getBridge } from "@repo/bridge/client";
import { SettingSwitchRow } from "@repo/workspace/settings/sections/setting-switch-row";
import {
  BIND_ALL_ADDRESS,
  endpointAddress,
  type PairingInfo,
  type RemoteAccessState,
} from "@repo/bridge/remote-access";

// Remote access — let other devices (the mobile companion) connect to this
// computer's ws transport. The host owns everything: the enable toggle and the
// network selection flip the server's bind, devices live in the paired-device
// store, and pairing tokens are minted host-side. The onRemoteAccessChanged
// subscription keeps this reactive across config/device/listen changes.
// Pairing info is kept local (transient) — it's a one-time secret shown once,
// not state.
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

  const handleBind = useCallback(async (address: string) => {
    const bridge = getBridge();
    setError(null);
    setPairing(null);
    try {
      setState(await bridge.setRemoteAccessConfig({ bindAddress: address }));
    } catch {
      setError("Failed to change the network.");
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
  const devices = state?.devices ?? [];
  const bindAddress = state?.bindAddress ?? BIND_ALL_ADDRESS;
  // Loopback is always bound and is not a remote choice — offering it would
  // mean "reachable by nobody", which is what the toggle already says.
  const bindable = (state?.endpoints ?? []).filter(
    (endpoint) => endpoint.reachability !== "loopback",
  );
  const bindsAll = bindAddress === BIND_ALL_ADDRESS;
  const selected = bindable.find((endpoint) => endpointAddress(endpoint) === bindAddress) ?? null;
  // What the host REPORTED binding, never what the selection implies: the two
  // differ whenever a pinned address was absent when the server came up.
  const boundAddresses = state?.boundAddresses ?? [];
  const reachable = bindable.filter(
    (endpoint) =>
      boundAddresses.includes(BIND_ALL_ADDRESS) ||
      boundAddresses.includes(endpointAddress(endpoint)),
  );
  const cleartext = reachable.some((endpoint) => !endpoint.encrypted);
  const encryptedOnly = reachable.find((endpoint) => endpoint.encrypted) ?? null;
  const missingBind = !bindsAll && selected === null;
  // Two different failures, two different remedies: `missingBind` means this
  // computer no longer holds that address at all, `unbound` means it does but
  // the server never got a socket on it (it came up after the bind).
  const unbound =
    enabled && selected !== null && !boundAddresses.includes(endpointAddress(selected));

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

          {enabled && (
            <>
              <p className="text-[10px] text-muted-foreground">
                {!cleartext && encryptedOnly !== null
                  ? `Reachable only over ${encryptedOnly.label}, which encrypts and authenticates the connection itself.`
                  : "Connections on your local network are unencrypted. Pair devices only on networks you trust."}
              </p>

              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">Reachable on</span>
                <NativeSelect
                  size="sm"
                  className="w-full"
                  aria-label="Reachable on"
                  value={bindAddress}
                  disabled={busy || loading}
                  onChange={(event) => void handleBind(event.target.value)}
                >
                  <NativeSelectOption value={BIND_ALL_ADDRESS}>Every network</NativeSelectOption>
                  {bindable.map((endpoint) => (
                    <NativeSelectOption
                      key={endpoint.wsUrl}
                      value={endpointAddress(endpoint)}
                    >{`${endpoint.label}${endpoint.encrypted ? " (encrypted)" : ""}`}</NativeSelectOption>
                  ))}
                  {missingBind && (
                    <NativeSelectOption value={bindAddress}>
                      {`${bindAddress} (unavailable)`}
                    </NativeSelectOption>
                  )}
                </NativeSelect>
                {missingBind && (
                  <span className="text-[10px] text-muted-foreground">
                    That network isn&apos;t available right now, so only this computer can reach the
                    app. Pick another to expose it again.
                  </span>
                )}
                {unbound && (
                  <span className="flex flex-col items-start gap-1 text-[10px] text-muted-foreground">
                    <span>
                      That network appeared after the app started listening, so nothing is answering
                      on it yet.
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleBind(bindAddress)}
                      disabled={busy || loading}
                      className="h-6 px-2 text-[10px]"
                    >
                      Listen on it now
                    </Button>
                  </span>
                )}
                {reachable.map((endpoint) => (
                  <code
                    key={endpoint.wsUrl}
                    className="select-all rounded-[8px] bg-card px-2.5 py-1.5 text-[10px] text-foreground"
                  >
                    {endpoint.wsUrl}
                  </code>
                ))}
              </div>

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
                      On the other device, connect to the address for the network it is on:
                    </span>
                    {pairing.urls.map((url) => (
                      <span key={url.wsUrl} className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-muted-foreground">{url.label}</span>
                        <code className="select-all rounded-[8px] bg-muted px-2.5 py-1.5 text-[10px] text-foreground">
                          {url.wsUrl}
                        </code>
                      </span>
                    ))}
                    <span className="text-[10px] text-muted-foreground">
                      Then enter this one-time code:
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
