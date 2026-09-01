// Settings → Devices: this install's relationship with an inteligir account.
//
// NOT called "Sync", and not by accident — the Vault section above already has
// a Sync row with a "Sync now" button, and that one moves FILES to a git
// remote. Two sections with the same title and the same button, moving
// different things to different places, is a UI that lies about what a click
// does. This one is named for what it holds (the pairing) and its button says
// what it moves (threads).
//
// PAIRING IS THE SWITCH, so this section has no toggle. A local-first app that
// opens a connection to a hosted service on first boot is not the product; an
// install syncs because someone approved it, and it stops because someone
// unpaired. A separate on/off beside that would be a second value that can
// disagree with the credential on disk.
//
// THERE IS NOTHING TO TYPE (issue #573). Pairing is one button: the server
// arms an approval, opens the browser at the account's approve page, and the
// browser brings the answer back to the loopback. The URL is shown beside the
// button because the auto-open is best-effort — a headless box or a machine
// with no `xdg-open` still has a link a person can carry to another screen.

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

/**
 * Nothing on the local ws bus announces a sync pass — the bus carries vault,
 * doc and thread invalidations, and sync state is none of those — so this
 * query polls while the settings page is open and stops with it. The section
 * is mounted only while that route is, which is what makes a poll here honest
 * rather than a background timer nobody asked for.
 */
const STATUS_POLL_MS = 5_000;

function useCloudStatus() {
  return useQuery({
    ...orpc.cloud.status.queryOptions(),
    staleTime: 0,
    refetchInterval: STATUS_POLL_MS,
  });
}

/** The seconds tier is on here and nowhere else: this row renders beside the
 *  button that refreshes it, so "Just now" would hide the freshness it exists
 *  to report. */
function lastSyncedLabel(epochMs: number | null, nowMs: number): string {
  return epochMs === null ? "never" : relativeTimeLabel(epochMs, nowMs, { seconds: true });
}

/** A clock matching that tier: the default minute tick would freeze "40s ago"
 *  until it flips to "1m ago". */
const LAST_SYNCED_TICK_MS = 1_000;

/**
 * What the section says once an approval is armed. Pure and total, so the
 * sentence is decided in one place rather than assembled inside the markup —
 * and so the "we could not open your browser" case is a value a test can name
 * rather than a branch that only appears on a headless machine.
 */
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
      <Button type="button" size="xs" onClick={onBegin} disabled={pending}>
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

  // Unpair and sync each answer with the WHOLE status, so success is a cache
  // write rather than an invalidation — the server has already said what it
  // left behind, and re-asking would be a second answer to one question.
  const applyStatus = (next: CloudStatusResponse): void => {
    queryClient.setQueryData(orpc.cloud.status.queryKey(), next);
  };

  // Beginning an approval answers a URL rather than a status: the status that
  // matters lands later, when the browser comes back and the poll above sees a
  // paired install.
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

  // The confirm runs OUTSIDE the lock: nothing is in flight while a dialog
  // waits for an answer, and a section greyed out meanwhile says otherwise.
  const unpair = (): void => {
    void (async () => {
      // The clause is conditional on the SOURCE: an account-derived vault
      // remote dies with the credential, a user-configured one does not —
      // and the dialog must not claim either about the other.
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
          <Button size="xs" variant="outline" onClick={unpair} disabled={pending}>
            Unpair
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <PairedDetails status={status} nowMs={now} />
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => {
                syncThreads.mutate();
              }}
            >
              Sync threads now
            </Button>
            <Button size="xs" variant="ghost" onClick={unpair} disabled={pending}>
              Unpair
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
