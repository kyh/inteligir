// No on/off toggle: the credential on disk is the switch, and a second value could disagree with
// it. The sync's raw state, this device's id and the last error are Settings › Advanced's; here a
// person sees who they are signed in as and which devices share the account, and removes one they
// lost from any device still signed in.

import { cloudDevicesPageUrl } from "@repo/api/local/cloud/cloud-schema";
import type { CloudDevice } from "@repo/api/local/cloud/cloud-schema";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AccountForm } from "../account-form";
import { failed, orpc } from "../api";
import { useCloudSession } from "../cloud-session";
import { relativeTimeLabel, useNow } from "../relative-time";
import { useDataDirScope, useVaultStatus } from "../vault-hooks";
import { PhoneRequestsRow } from "./phone-requests-row";
import { Row, SecondVaultNote, SectionHeading } from "./settings-chrome";

export const RevokeFailedNotice = ({ cloudUrl }: { cloudUrl: string }) => {
  const devicesUrl = cloudDevicesPageUrl(cloudUrl);
  return (
    <p className="text-body text-muted-foreground">
      This Mac could not remove itself from your account. Remove it from Settings › Account on
      another device, or at{" "}
      <a
        href={devicesUrl}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        {devicesUrl}
      </a>
      .
    </p>
  );
};

export const SignedOutByAccount = ({ onSignInAgain }: { onSignInAgain: () => void }) => (
  <div className="space-y-2">
    <p className="text-body text-muted-foreground">This Mac was signed out of your account.</p>
    <Button size="compact" variant="tertiary" onClick={onSignInAgain}>
      Sign in again
    </Button>
  </div>
);

export type DeviceListState =
  | { kind: "loading" }
  | { kind: "failed"; retrying: boolean }
  | { kind: "loaded"; devices: readonly CloudDevice[] };

export interface AccountDevicesProps {
  // what this Mac's commits and conflict copies call it
  thisMacName: string | undefined;
  lastSyncedAt: number | null;
  nowMs: number;
  devices: DeviceListState;
  revokingId: string | null;
  onRevoke: (deviceId: string) => void;
  onRetry: () => void;
}

const DEVICES_UNREACHABLE = "Couldn't reach your account to list its devices.";

const syncedLabel = (lastSyncedAt: number | null, nowMs: number): string =>
  lastSyncedAt === null
    ? "Not synced yet"
    : `Synced ${relativeTimeLabel(lastSyncedAt, nowMs, { inSentence: true })}`;

const lastSeenLabel = (lastSeenAt: number | null, nowMs: number): string =>
  lastSeenAt === null
    ? "Not seen yet"
    : `Last seen ${relativeTimeLabel(lastSeenAt, nowMs, { inSentence: true })}`;

const OtherDevices = ({
  devices,
  nowMs,
  revokingId,
  onRevoke,
  onRetry,
}: Omit<AccountDevicesProps, "thisMacName" | "lastSyncedAt">) => {
  const askToRevoke = (device: CloudDevice): void => {
    void (async () => {
      const confirmed = await confirm({
        body: `${device.name} stops syncing at once, and needs your password to sign in again. Nothing on it is deleted.`,
        confirmLabel: "Revoke",
        destructive: true,
        title: `Revoke ${device.name}?`,
      });
      if (confirmed) {
        onRevoke(device.id);
      }
    })();
  };

  switch (devices.kind) {
    case "loading": {
      return <span className="text-body text-muted-foreground">…</span>;
    }
    case "failed": {
      return (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-body text-muted-foreground">{DEVICES_UNREACHABLE}</span>
          <Button size="compact" variant="tertiary" disabled={devices.retrying} onClick={onRetry}>
            Try again
          </Button>
        </span>
      );
    }
    case "loaded": {
      const others = devices.devices.filter((device) => !device.current);
      if (others.length === 0) {
        return <span className="text-body text-muted-foreground">None</span>;
      }
      return (
        <ul className="space-y-1.5">
          {others.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-4">
              <span className="min-w-0">
                <span className="block truncate text-body">{device.name}</span>
                <span className="block text-body text-muted-foreground">
                  {lastSeenLabel(device.lastSeenAt, nowMs)}
                </span>
              </span>
              <Button
                size="compact"
                variant="tertiary"
                aria-label={`Revoke ${device.name}`}
                disabled={revokingId === device.id}
                onClick={() => {
                  askToRevoke(device);
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      );
    }
    default: {
      const exhaustive: never = devices;
      return exhaustive;
    }
  }
};

export const AccountDevices = ({ thisMacName, lastSyncedAt, ...others }: AccountDevicesProps) => (
  <>
    <Row label="This Mac">
      <span className="block truncate text-body">{thisMacName ?? "…"}</span>
      <span className="block text-body text-muted-foreground">
        {syncedLabel(lastSyncedAt, others.nowMs)}
      </span>
    </Row>
    <Row label="Other devices">
      <OtherDevices {...others} />
    </Row>
  </>
);

export const AccountSection = () => {
  const { status, pending, refusal, signIn, signOut, signUp } = useCloudSession();
  const scope = useDataDirScope();
  const vaultStatus = useVaultStatus().data;
  const nowMs = useNow();
  const queryClient = useQueryClient();
  // the refused credential this person chose to replace: a later refusal asks again
  const [signInAgainFor, setSignInAgainFor] = useState<string | null>(null);
  // no bus kind names this query, so it re-reads on every mount; a refusal is shown at once, with
  // its own Try again, rather than after a retry's backoff
  const devicesQuery = useQuery({
    ...orpc.cloud.devices.queryOptions(),
    enabled: status?.state === "signed-in",
    retry: false,
    staleTime: 0,
  });
  const revoke = useMutation(
    orpc.cloud.revokeDevice.mutationOptions({
      onError: (cause) => {
        failed(cause, "Could not revoke that device.");
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.cloud.devices.key() });
      },
    }),
  );

  const deviceList = (): DeviceListState => {
    if (devicesQuery.isError) {
      return { kind: "failed", retrying: devicesQuery.isFetching };
    }
    return devicesQuery.data === undefined
      ? { kind: "loading" }
      : { devices: devicesQuery.data.devices, kind: "loaded" };
  };

  const accountForm = (cloudUrl: string) => (
    <AccountForm
      cloudUrl={cloudUrl}
      onCreate={signUp}
      onSignIn={signIn}
      pending={pending}
      refusal={refusal}
    />
  );

  const body = () => {
    if (status === undefined) {
      return <p className="text-subtitle text-muted-foreground">…</p>;
    }
    if (status.state === "signed-out") {
      return (
        <div className="space-y-2">
          <SecondVaultNote scope={scope} />
          {status.revokeError === null ? null : <RevokeFailedNotice cloudUrl={status.cloudUrl} />}
          {accountForm(status.cloudUrl)}
        </div>
      );
    }
    if (status.state === "unauthorized") {
      // a sign-in replaces the refused credential directly: there is nothing left to sign out of
      return signInAgainFor === status.deviceId ? (
        accountForm(status.cloudUrl)
      ) : (
        <SignedOutByAccount
          onSignInAgain={() => {
            setSignInAgainFor(status.deviceId);
          }}
        />
      );
    }
    return (
      <div className="space-y-2">
        <dl className="space-y-1.5">
          <Row label="Account">
            <span className="block truncate text-body">
              {status.accountEmail ?? new URL(status.cloudUrl).host}
            </span>
          </Row>
          <AccountDevices
            thisMacName={vaultStatus?.device}
            lastSyncedAt={status.lastSyncedAt}
            nowMs={nowMs}
            devices={deviceList()}
            revokingId={revoke.isPending ? (revoke.variables?.deviceId ?? null) : null}
            onRevoke={(deviceId) => {
              revoke.mutate({ deviceId });
            }}
            onRetry={() => {
              void devicesQuery.refetch();
            }}
          />
          <PhoneRequestsRow />
        </dl>
        <Button size="compact" variant="ghost" onClick={signOut} disabled={pending}>
          Sign out
        </Button>
      </div>
    );
  };

  return (
    <section className="space-y-2">
      <SectionHeading>Account</SectionHeading>
      {body()}
    </section>
  );
};
