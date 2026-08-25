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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "../api";
import { useWorkspace } from "../workspace-context";
import { failed, Row, SectionHeading } from "./settings-chrome";

/**
 * Nothing on the local ws bus announces a sync pass — the bus carries vault,
 * doc and thread invalidations, and sync state is none of those — so this
 * query polls while the dialog is open and stops with it. The dialog body is
 * mounted only while open, which is what makes a poll here honest rather than
 * a background timer nobody asked for.
 */
const STATUS_POLL_MS = 5_000;

function useCloudStatus() {
  return useQuery({
    ...orpc.cloud.status.queryOptions(),
    staleTime: 0,
    refetchInterval: STATUS_POLL_MS,
  });
}

function relativeTime(epochMs: number | null): string {
  if (epochMs === null) {
    return "never";
  }
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m ago`;
  }
  return new Date(epochMs).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

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
        Pairing sends you to {new URL(cloudUrl).host} to approve this device. Threads and their
        history sync; your notes stay in the vault, versioned by git.
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
}

export function PairedDetails({ status }: PairedDetailsProps) {
  return (
    <dl className="space-y-1.5">
      <Row label="Account">
        <span className="block truncate font-mono text-xs">{new URL(status.cloudUrl).host}</span>
      </Row>
      <Row label="Device">
        <span className="block truncate font-mono text-xs">{status.deviceId}</span>
      </Row>
      <Row label="State">
        <span className="text-xs">
          {status.connected ? "Following" : "Polling"} · {status.pending} queued · synced{" "}
          {relativeTime(status.lastSyncedAt)}
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
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const statusQuery = useCloudStatus();
  const [pending, setPending] = useState(false);
  const [begun, setBegun] = useState<CloudPairBeginResponse | null>(null);

  // Every verb here is the same act: lock the section, ask the server, take
  // the whole status it answers with, and say what went wrong in this verb's
  // own words. Three copies of that lifecycle is three places a `finally` can
  // go missing and leave the section disabled for good.
  const perform = (fallback: string, call: () => Promise<CloudStatusResponse>): void => {
    setPending(true);
    void (async () => {
      try {
        const next = await call();
        queryClient.setQueryData(orpc.cloud.status.queryKey(), () => next);
      } catch (error) {
        failed(error, fallback);
      } finally {
        setPending(false);
      }
    })();
  };

  // Not `perform`: beginning an approval answers a URL rather than a status,
  // and the status that matters lands later — when the browser comes back and
  // the poll above sees a paired install.
  const beginPair = (): void => {
    setPending(true);
    void (async () => {
      try {
        setBegun(await api.cloud.pairBegin({ openBrowser: true }));
      } catch (error) {
        failed(error, "Could not start pairing.");
      } finally {
        setPending(false);
      }
    })();
  };

  // The confirm runs OUTSIDE the lock: nothing is in flight while a dialog
  // waits for an answer, and a section greyed out meanwhile says otherwise.
  const unpair = (): void => {
    void (async () => {
      const confirmed = await confirm({
        title: "Stop syncing this device?",
        body: "This machine forgets its credential and everything queued for the cloud. Your notes and threads stay here. The device stays listed on your account until you revoke it there.",
        confirmLabel: "Unpair",
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      setBegun(null);
      perform("Could not unpair this device.", async () => api.cloud.unpair());
    })();
  };

  const syncNow = (): void => {
    perform("Could not run a sync.", async () => api.cloud.syncNow());
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
          onBegin={beginPair}
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
          <PairedDetails status={status} />
          <div className="flex gap-2">
            <Button size="xs" variant="outline" onClick={syncNow} disabled={pending}>
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
