import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import {
  DEVICE_API_PATHS,
  listDevicesResponseSchema,
  mintPairingCodeResponseSchema,
  type Device,
  type MintPairingCodeResponse,
} from "@repo/cloud-contract/pairing";
import { Button } from "@repo/ui/components/button";

import { AuthError } from "@/components/auth-shell";
import { currentSession } from "@/lib/session-guard";
import { siteConfig } from "@/lib/site-config";

// ---------------------------------------------------------------------------
// `/app/devices` — the signed-in dashboard for device pairing: mint a one-time
// code for the local app, see every paired device, revoke one (which cuts it
// off on its next request — the credential check is never cached).
//
// `ssr: false`: everything on this page depends on the live session and the
// device table, neither of which a server render can have — the shell would be
// an empty frame either way, so it doesn't earn the flag's inheritance hazard
// (see routes/app.tsx). The guard direction is the inverse of the auth pages':
// signed-OUT visitors are sent to sign-in, and only the client can know.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/app/devices")({
  ssr: false,
  beforeLoad: async () => {
    if (import.meta.env.SSR) return;
    if ((await currentSession()) === null) throw redirect({ to: "/app/sign-in" });
  },
  component: DevicesPage,
});

async function fetchDevices(): Promise<Device[]> {
  const response = await fetch(DEVICE_API_PATHS.list);
  if (!response.ok) throw new Error("Couldn't load devices.");
  return listDevicesResponseSchema.parse(await response.json()).devices;
}

async function mintCode(): Promise<MintPairingCodeResponse> {
  const response = await fetch(DEVICE_API_PATHS.mintCode, { method: "POST" });
  if (!response.ok) throw new Error("Couldn't mint a pairing code.");
  return mintPairingCodeResponseSchema.parse(await response.json());
}

async function revokeDevice(deviceId: string): Promise<void> {
  const response = await fetch(DEVICE_API_PATHS.revoke, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  if (!response.ok) throw new Error("Couldn't revoke that device.");
}

function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [minted, setMinted] = useState<MintPairingCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void fetchDevices().then(setDevices, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "Couldn't load devices.");
    });
  }, []);

  useEffect(refresh, [refresh]);

  const onMint = () => {
    setError(null);
    void mintCode().then(setMinted, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "Couldn't mint a pairing code.");
    });
  };

  const onRevoke = (deviceId: string) => {
    setError(null);
    void revokeDevice(deviceId).then(refresh, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "Couldn't revoke that device.");
    });
  };

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-16">
      <Link to="/" className="mb-8 block text-sm font-medium tracking-tight">
        {siteConfig.name}
      </Link>
      <h1 className="text-lg font-medium tracking-tight">Devices</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pair the local app with your account: mint a code here, enter it in the app within ten
        minutes. Each device gets its own credential; revoking one cuts it off immediately.
      </p>

      <div className="mt-6 grid gap-3">
        <div>
          <Button type="button" onClick={onMint}>
            Pair a device
          </Button>
        </div>
        {minted === null ? null : (
          <div className="rounded-md border p-4">
            <div className="font-mono text-2xl tracking-widest">{minted.code}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              One-time code — expires in {Math.round(minted.expiresInMs / 60_000)} minutes.
            </p>
          </div>
        )}
        <AuthError message={error} />
      </div>

      <h2 className="mt-10 text-sm font-medium">Paired devices</h2>
      <DeviceList devices={devices} onRevoke={onRevoke} />
    </main>
  );
}

function DeviceList({
  devices,
  onRevoke,
}: {
  devices: Device[] | null;
  onRevoke: (deviceId: string) => void;
}) {
  if (devices === null) {
    return <p className="mt-2 text-sm text-muted-foreground">Loading…</p>;
  }
  if (devices.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">No devices paired yet.</p>;
  }
  return (
    <ul className="mt-2 divide-y rounded-md border">
      {devices.map((device) => (
        <li key={device.id} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{device.name}</div>
            <div className="text-xs text-muted-foreground">
              {device.revokedAt !== null
                ? `Revoked ${formatWhen(device.revokedAt)}`
                : device.lastSeenAt !== null
                  ? `Last seen ${formatWhen(device.lastSeenAt)}`
                  : "Never connected"}
            </div>
          </div>
          {device.revokedAt !== null ? null : (
            <Button type="button" variant="outline" size="sm" onClick={() => onRevoke(device.id)}>
              Revoke
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function formatWhen(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
