import { useState } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { readCloudCall } from "@repo/api/cloud/client";
import type { CloudFailure } from "@repo/api/cloud/client";
import {
  DEVICE_API_PATHS,
  listDevicesResponseSchema,
  revokeDeviceResponseSchema,
} from "@repo/api/cloud/device/device-schema";
import type { Device, RevokeDeviceRequest } from "@repo/api/cloud/device/device-schema";
import { Button } from "@repo/ui/components/button";

import { AuthError, CONNECTION_FAILED } from "@/components/auth-shell";
import { currentSession } from "@/lib/session-guard";
import { siteConfig } from "@/lib/site-config";

// Nothing here adds a device: a device signs in from the app with the account's own password.
// ssr: false because everything here depends on the live session, and only the client can send
// a signed-out visitor to sign-in.

const redirectToSignIn = (href: string) =>
  redirect({ to: "/app/sign-in", search: { next: href }, throw: true });

// a session that ended since the guard read it answers the list and the revoke alike
const isSignedOut = (failure: CloudFailure): boolean =>
  failure.kind === "refused" && failure.code === "unauthorized";

const failureMessage = (failure: CloudFailure): string =>
  failure.kind === "unreachable" ? CONNECTION_FAILED : failure.message;

const DevicesShell = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto w-full max-w-lg px-6 py-16">
    <Link to="/" className="mb-8 block text-sm font-medium tracking-tight">
      {siteConfig.name}
    </Link>
    <h1 className="text-lg font-medium tracking-tight">Devices</h1>
    <p className="mt-1 text-sm text-muted-foreground">
      To add a Mac or a phone, sign in on it with this account. Revoking a device cuts it off at
      once; a signed-in Mac can do the same from Settings › Account.
    </p>
    {children}
  </main>
);

const DevicesPage = () => {
  const router = useRouter();
  const devices = Route.useLoaderData();
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const revoke = async (deviceId: string) => {
    setRevoking(deviceId);
    setError(null);
    const request: RevokeDeviceRequest = { deviceId };
    const result = await readCloudCall(
      async () =>
        await fetch(DEVICE_API_PATHS.revoke, {
          body: JSON.stringify(request),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      revokeDeviceResponseSchema,
    );
    if (!result.ok && !isSignedOut(result.failure)) {
      setError(failureMessage(result.failure));
    }
    // a refused revoke is as likely a stale row as a fault, and a signed-out session is the
    // loader's to send to sign-in, so the list is read again either way
    await router.invalidate({ sync: true });
    setRevoking(null);
  };

  return (
    <DevicesShell>
      <div className="mt-6">
        <AuthError message={error} />
      </div>
      <h2 className="mt-4 text-sm font-medium">Signed-in devices</h2>
      <DeviceList
        devices={devices}
        revoking={revoking}
        onRevoke={(deviceId) => {
          void revoke(deviceId);
        }}
      />
    </DevicesShell>
  );
};

const DeviceList = ({
  devices,
  revoking,
  onRevoke,
}: {
  devices: Device[];
  revoking: string | null;
  onRevoke: (deviceId: string) => void;
}) => {
  if (devices.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">No devices signed in yet.</p>;
  }
  return (
    <ul className="mt-2 divide-y rounded-md border">
      {devices.map((device) => (
        <li key={device.id} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{device.name}</div>
            <div className="text-xs text-muted-foreground">{deviceStatus(device)}</div>
          </div>
          {device.revokedAt === null ? (
            <Button
              type="button"
              variant="tertiary"
              size="compact"
              disabled={revoking === device.id}
              onClick={() => {
                onRevoke(device.id);
              }}
            >
              {revoking === device.id ? "Revoking…" : "Revoke"}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
};

const deviceStatus = (device: Device): string => {
  if (device.revokedAt !== null) {
    return `Revoked ${formatWhen(device.revokedAt)}`;
  }
  return device.lastSeenAt === null
    ? "Never connected"
    : `Last seen ${formatWhen(device.lastSeenAt)}`;
};

const formatWhen = (epochMs: number): string =>
  new Date(epochMs).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const DevicesPending = () => (
  <DevicesShell>
    <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
  </DevicesShell>
);

const DevicesError = ({ error }: ErrorComponentProps) => {
  const router = useRouter();
  return (
    <DevicesShell>
      <div className="mt-6 grid justify-items-start gap-3">
        <AuthError message={error instanceof Error ? error.message : "Couldn't load devices."} />
        <Button
          type="button"
          variant="secondary"
          size="compact"
          onClick={() => {
            void router.invalidate();
          }}
        >
          Try again
        </Button>
      </div>
    </DevicesShell>
  );
};

export const Route = createFileRoute("/app/devices")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const session = await currentSession();
    if (session.kind === "signed-out") {
      redirectToSignIn(location.href);
    }
    if (session.kind === "unknown") {
      throw new Error(session.message);
    }
  },
  loader: async ({ location }) => {
    const result = await readCloudCall(
      async () => await fetch(DEVICE_API_PATHS.list),
      listDevicesResponseSchema,
    );
    if (result.ok) {
      return result.value.devices;
    }
    if (isSignedOut(result.failure)) {
      redirectToSignIn(location.href);
    }
    throw new Error(failureMessage(result.failure));
  },
  pendingComponent: DevicesPending,
  errorComponent: DevicesError,
  component: DevicesPage,
});
