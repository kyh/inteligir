import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";

import { getBridge } from "@renderer/lib/bridge";
import type { DeviceRecord } from "@repo/notes/sync/wire";
import type { SyncDeviceInfo, SyncPairingOffer } from "@repo/bridge/sync";

// The vault's devices — the account-free identity model. A vault is owned by
// the set of keys enrolled in it, and its id is the fingerprint of the key that
// founded it, so this panel is where "which vault is this, and who can reach
// it" is answered.
//
// Two shapes, and the difference is the whole design:
//   - REVOKE is a server act on ANOTHER device: a permanent tombstone,
//     effective on that device's next request.
//   - DISCONNECT is a local act on THIS one: forget the key, stop syncing, no
//     server call. The coordinator refuses the revoke that would leave a vault
//     with no live key, because it cannot tell "I am leaving" from "strand this
//     vault" — so this device never offers itself a revoke.

/** How the fingerprint is shown: enough of the key to tell two devices apart
 * by eye, without pretending the whole thing is readable. */
function fingerprint(publicKey: string): string {
  return publicKey.slice(0, 12);
}

function formatDay(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString();
}

export function SyncDevices({
  device,
  coordinatorUrl,
}: {
  device: SyncDeviceInfo | null;
  coordinatorUrl: string;
}) {
  const [devices, setDevices] = useState<readonly DeviceRecord[] | null>(null);
  const [offer, setOffer] = useState<SyncPairingOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vaultId = device?.vaultId ?? null;
  const loadRoster = useCallback(() => {
    // Any roster change retires a shown offer: the blob is a live capability
    // for its whole TTL, and leaving it on screen next to a device that just
    // changed reads as if it belonged to that device.
    setOffer(null);
    if (vaultId === null) {
      setDevices(null);
      return;
    }
    void getBridge()
      .getSyncDevices()
      .then((result) => {
        if (result.ok) {
          setDevices(result.devices);
        } else {
          setDevices([]);
          setError(result.error);
        }
        return undefined;
      })
      .catch(() => setError("Could not reach the server."));
  }, [vaultId]);

  useEffect(loadRoster, [loadRoster]);

  const handleReconnect = useCallback(async () => {
    const confirmed = await confirm({
      title: "Reconnect this vault?",
      body: "This computer creates its own sync key and a brand-new vault on the server, then uploads every file to it. Nothing is deleted — not on this computer, and not on the vault you sync to today, which stays exactly as it is in case you want to switch back. Phones and other computers stop syncing until you pair them again.",
      confirmLabel: "Reconnect",
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await getBridge().reconnectSyncVault();
      if (!result.ok) setError(result.error);
    } catch {
      setError("Could not create a key for this device.");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    const confirmed = await confirm({
      title: "Disconnect this vault?",
      body: "This computer forgets its sync key and stops syncing. Your notes stay on disk, and the copy on the server is left untouched — but without this key nothing here can reach it again, so reconnecting starts a fresh vault and re-uploads everything.",
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await getBridge().disconnectSyncVault();
      setOffer(null);
    } catch {
      setError("Could not disconnect this vault.");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleRevoke = useCallback(
    async (target: DeviceRecord) => {
      const confirmed = await confirm({
        title: `Remove “${target.name}”?`,
        body: "That device stops being able to reach this vault, immediately and permanently. It can rejoin only by pairing again with a new key.",
        confirmLabel: "Remove",
        destructive: true,
      });
      if (!confirmed) return;
      setBusy(true);
      setError(null);
      try {
        const result = await getBridge().revokeSyncDevice({ publicKey: target.publicKey });
        if (!result.ok) setError(result.error);
        loadRoster();
      } catch {
        setError("Could not remove that device.");
      } finally {
        setBusy(false);
      }
    },
    [loadRoster],
  );

  const handlePair = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await getBridge().createSyncPairingOffer();
      if (result.ok) {
        setOffer(result.offer);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Could not create a pairing code.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (device === null) {
    return (
      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
        <span className="text-[10px] text-muted-foreground">
          This vault syncs through your account. You can instead give this computer its own key and
          let it own the vault — no account, and pairing a phone becomes one pasted code. It starts
          a new vault on the server and uploads everything to it; the vault you sync to today is
          left as it is.
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleReconnect()}
          disabled={busy || coordinatorUrl.trim() === ""}
          className="h-7 self-start px-3 text-[10px]"
        >
          Reconnect this vault
        </Button>
        {coordinatorUrl.trim() === "" && (
          <span className="text-[10px] text-muted-foreground">
            Set a server URL under Account first.
          </span>
        )}
        {error !== null && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    );
  }

  const roster = devices ?? [];
  const others = roster.filter((entry) => entry.publicKey !== device.publicKey);

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      <span className="text-[10px] text-muted-foreground">Devices</span>

      <div className="flex flex-col gap-0.5 rounded-[8px] bg-card px-2.5 py-1.5">
        <span className="text-xs text-foreground">This computer</span>
        <span className="text-[10px] text-muted-foreground">
          Key {fingerprint(device.publicKey)}… · connected {formatDay(device.foundedAt)}
        </span>
        <span className="text-[10px] text-muted-foreground">Vault</span>
        <code className="select-all break-all text-[10px] text-foreground">{device.vaultId}</code>
      </div>

      {others.map((entry) => (
        <div
          key={entry.publicKey}
          className="flex items-center justify-between gap-2 rounded-[8px] bg-card px-2.5 py-1.5"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs text-foreground">{entry.name}</span>
            <span className="truncate text-[10px] text-muted-foreground">
              {entry.revokedAt === null
                ? `Key ${fingerprint(entry.publicKey)}… · paired ${formatDay(entry.enrolledAt)}`
                : `Removed ${formatDay(entry.revokedAt)}`}
            </span>
          </span>
          {entry.revokedAt === null && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleRevoke(entry)}
              disabled={busy}
              className="h-auto shrink-0 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              Remove
            </Button>
          )}
        </div>
      ))}

      {devices === null && <span className="text-[10px] text-muted-foreground">Loading…</span>}

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handlePair()}
          disabled={busy}
          className="h-7 px-3 text-[10px]"
        >
          Pair a device
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleDisconnect()}
          disabled={busy}
          className="h-auto px-2 py-0.5 text-[10px] text-destructive"
        >
          Disconnect this vault
        </Button>
      </div>

      {offer !== null && (
        <div className="flex flex-col gap-1 rounded-[8px] bg-card px-2.5 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            Paste this into the other device to join it to this vault:
          </span>
          <code className="select-all break-all rounded-[8px] bg-muted px-2.5 py-1.5 text-[10px] text-foreground">
            {offer.blob}
          </code>
          <span className="text-[10px] text-muted-foreground">
            Single use, and only until{" "}
            {new Date(offer.expiresAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
            . Anyone who reads it before then can join, so don&apos;t leave it on the clipboard.
          </span>
        </div>
      )}

      {error !== null && <span className="text-[10px] text-destructive">{error}</span>}
    </div>
  );
}
