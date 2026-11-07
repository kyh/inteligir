import { useState } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { Device } from "@repo/contract/cloud/device/device-schema";
import { refusalText } from "@repo/contract/cloud/refusal-text";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import { Button } from "@repo/ui/components/button";

import { AuthError, CONNECTION_FAILED } from "#components/auth-shell";
import { LibraryLink } from "#components/library-link";
import { currentSession } from "#lib/session-guard";
import { siteConfig } from "#lib/site-config";
import { isOrpcError } from "@repo/contract/cloud/v1/errors";

// Nothing here adds a device: a device signs in from the app with the account's own password.
// ssr: false because everything here depends on the live session, and only the client can send
// a signed-out visitor to sign-in.

const redirectToSignIn = (href: string) =>
  redirect({ to: "/app/sign-in", search: { next: href }, throw: true });

// the page's calls, on its session's cookie, to this origin's `account.devices`
const account = (): V1Client["account"] =>
  createORPCClient<V1Client>(new RPCLink({ origin: window.location.origin, url: V1_RPC_PATH }))
    .account;

// a session that ended since the guard read it answers the list and the revoke alike
const isSignedOut = (cause: unknown): boolean =>
  isOrpcError(cause) && cause.defined && cause.code === "UNAUTHORIZED";

const DevicesShell = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto w-full max-w-lg px-6 py-16">
    <div className="mb-8 flex items-baseline justify-between gap-4">
      <Link to="/" className="text-sm font-medium tracking-tight">
        {siteConfig.name}
      </Link>
      <LibraryLink className="text-sm text-muted-foreground underline underline-offset-4" />
    </div>
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
    try {
      await account().devices.revoke({ deviceId });
    } catch (error_) {
      if (!isSignedOut(error_)) {
        setError(refusalText(error_, CONNECTION_FAILED));
      }
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
    try {
      const { devices } = await account().devices.list();
      return devices;
    } catch (error) {
      if (isSignedOut(error)) {
        redirectToSignIn(location.href);
      }
      throw new Error(refusalText(error, CONNECTION_FAILED), { cause: error });
    }
  },
  pendingComponent: DevicesPending,
  errorComponent: DevicesError,
  component: DevicesPage,
});
