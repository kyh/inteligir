import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import {
  DEVICE_API_PATHS,
  listDevicesResponseSchema,
  type Device,
} from "@repo/api/cloud/pairing/pairing-schema";
import { Button } from "@repo/ui/components/button";

import { AuthError } from "@/components/auth-shell";
import { currentSession } from "@/lib/session-guard";
import { siteConfig } from "@/lib/site-config";

// ---------------------------------------------------------------------------
// `/app/devices` — the signed-in audit surface: every paired device, and the
// revoke that cuts one off on its next request (the credential check is never
// cached).
//
// NOTHING HERE SHOWS A CODE TO A HUMAN. Codes still exist and are
// still the artifact a pairing turns on, but the only thing that ever sees one
// is `/app/pair`, which mints it on an approval and puts it straight in a
// redirect. A "mint a code" button here would be a second way to pair whose
// whole value was that a person could retype what it printed.
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
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void fetchDevices().then(setDevices, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Couldn't load devices.");
    });
  }, []);

  useEffect(refresh, [refresh]);

  const onRevoke = (deviceId: string) => {
    setError(null);
    void revokeDevice(deviceId).then(refresh, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Couldn't revoke that device.");
    });
  };

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-16">
      <Link to="/" className="mb-8 block text-sm font-medium tracking-tight">
        {siteConfig.name}
      </Link>
      <h1 className="text-lg font-medium tracking-tight">Devices</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        To pair a machine, start it there — Settings → Devices in the app, or{" "}
        <code>inteligir sync pair</code> — and approve it in the browser it opens. Each device gets
        its own credential; revoking one cuts it off immediately.
      </p>

      <div className="mt-6">
        <AuthError message={error} />
      </div>

      <h2 className="mt-4 text-sm font-medium">Paired devices</h2>
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
            <Button
              type="button"
              variant="tertiary"
              size="compact"
              onClick={() => onRevoke(device.id)}
            >
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
