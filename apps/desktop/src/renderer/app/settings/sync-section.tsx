// Not titled "Sync", and its button names threads: the Vault section already
// has a "Sync now" that pushes files. No on/off toggle: the credential on disk
// is the switch, and a second value could disagree with it.

import type {
  CloudPairBeginResponse,
  CloudStatusResponse,
} from "@repo/api/local/cloud/cloud-schema";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "../api";
import { relativeTimeLabel, useNow } from "../relative-time";
import { useVaultStatus } from "../vault-hooks";
import { failed, Row, SectionHeading } from "./settings-chrome";

// Nothing on the ws bus announces a sync pass, so the status polls while the
// page is mounted.
const STATUS_POLL_MS = 5_000;

function useCloudStatus() {
  return useQuery({
    ...orpc.cloud.status.queryOptions(),
    staleTime: 0,
    refetchInterval: STATUS_POLL_MS,
  });
}

function lastSyncedLabel(epochMs: number | null, nowMs: number): string {
  return epochMs === null ? "never" : relativeTimeLabel(epochMs, nowMs, { seconds: true });
}

// Must match the seconds tier above, or "40s ago" freezes until the minute tick.
const LAST_SYNCED_TICK_MS = 1_000;

export function describeBegun(begun: CloudPairBeginResponse): string {
  const minutes = Math.round(begun.expiresInMs / 60_000);
  return begun.opened
    ? `Approve “${begun.deviceName}” in the browser window that just opened. The link works for ${minutes} minutes.`
    : `Open this link to approve “${begun.deviceName}”. It works for ${minutes} minutes.`;
}

export interface PairPromptProps {
  cloudUrl: string;
  begun: CloudPairBeginResponse | null;
  onBegin: () => void;
  pending: boolean;
}

export function PairPrompt({ cloudUrl, begun, onBegin, pending }: PairPromptProps) {
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Pairing sends you to {new URL(cloudUrl).host} to approve this device. Your threads and your
        vault then sync through your account — unless this machine is configured with its own git
        remote.
      </p>
      <Button type="button" size="compact" onClick={onBegin} disabled={pending}>
        Pair with browser
      </Button>
      {begun === null ? null : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{describeBegun(begun)}</p>
          <a
            href={begun.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate font-mono text-xs underline underline-offset-2"
          >
            {begun.url}
          </a>
        </div>
      )}
    </div>
  );
}

export interface PairedDetailsProps {
  status: Extract<CloudStatusResponse, { state: "paired" }>;
  nowMs: number;
}

export function PairedDetails({ status, nowMs }: PairedDetailsProps) {
  return (
    <dl className="space-y-1.5">
      <Row label="Account">
        <span className="block truncate font-mono text-xs">
          {status.accountEmail ?? new URL(status.cloudUrl).host}
        </span>
      </Row>
      <Row label="Device">
        <span className="block truncate font-mono text-xs">{status.deviceId}</span>
      </Row>
      <Row label="State">
        <span className="text-xs">
          {status.connected ? "Following" : "Polling"} · {status.pending} queued · synced{" "}
          {lastSyncedLabel(status.lastSyncedAt, nowMs)}
        </span>
      </Row>
      {status.lastError === null ? null : (
        <Row label="Last error">
          <span className="text-xs text-muted-foreground">{status.lastError}</span>
        </Row>
      )}
    </dl>
  );
}

export function SyncSection() {
  const queryClient = useQueryClient();
  const { data: vaultStatus } = useVaultStatus();
  const statusQuery = useCloudStatus();
  const now = useNow(LAST_SYNCED_TICK_MS);
  const [begun, setBegun] = useState<CloudPairBeginResponse | null>(null);

  const applyStatus = (next: CloudStatusResponse): void => {
    queryClient.setQueryData(orpc.cloud.status.queryKey(), next);
  };

  const pairBegin = useMutation(
    orpc.cloud.pairBegin.mutationOptions({
      onSuccess: setBegun,
      onError: (error) => {
        failed(error, "Could not start pairing.");
      },
    }),
  );
  const unpairDevice = useMutation(
    orpc.cloud.unpair.mutationOptions({
      onSuccess: applyStatus,
      onError: (error) => {
        failed(error, "Could not unpair this device.");
      },
    }),
  );
  const syncThreads = useMutation(
    orpc.cloud.syncNow.mutationOptions({
      onSuccess: applyStatus,
      onError: (error) => {
        failed(error, "Could not run a sync.");
      },
    }),
  );
  const pending = pairBegin.isPending || unpairDevice.isPending || syncThreads.isPending;

  // Confirm before mutate: a section greyed out while the dialog waits claims
  // work that has not started.
  const unpair = (): void => {
    void (async () => {
      // Only an account-derived vault remote dies with the credential.
      const vaultPaired =
        vaultStatus !== undefined &&
        vaultStatus.state !== "no-remote" &&
        vaultStatus.remoteSource === "paired";
      const confirmed = await confirm({
        title: "Stop syncing this device?",
        body: `This machine forgets its credential and everything queued for the cloud.${vaultPaired ? " Your vault stops syncing through your account." : ""} Your notes and threads stay here. The device stays listed on your account until you revoke it there.`,
        confirmLabel: "Unpair",
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      setBegun(null);
      unpairDevice.mutate();
    })();
  };

  const status = statusQuery.data;

  return (
    <section className="space-y-2">
      <SectionHeading>Devices</SectionHeading>
      {status === undefined ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : status.state === "off" ? (
        <PairPrompt
          cloudUrl={status.cloudUrl}
          begun={begun}
          onBegin={() => {
            pairBegin.mutate({ openBrowser: true });
          }}
          pending={pending}
        />
      ) : status.state === "unauthorized" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {status.detail} Sync is stopped. Unpair, then pair this device again.
          </p>
          <Button size="compact" variant="tertiary" onClick={unpair} disabled={pending}>
            Unpair
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <PairedDetails status={status} nowMs={now} />
          <div className="flex gap-2">
            <Button
              size="compact"
              variant="tertiary"
              disabled={pending}
              onClick={() => {
                syncThreads.mutate();
              }}
            >
              Sync threads now
            </Button>
            <Button size="compact" variant="ghost" onClick={unpair} disabled={pending}>
              Unpair
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
