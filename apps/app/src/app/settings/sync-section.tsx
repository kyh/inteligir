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
// install syncs because someone typed a code, and it stops because someone
// unpaired. A separate on/off beside that would be a second value that can
// disagree with the credential on disk.
//
// The code comes from the account's own Devices page and is typed here — the
// direction matters, because it means this machine never holds an account
// session, only a device credential it can be cut off from.

import {
  CLOUD_DEVICE_NAME_MAX_LENGTH,
  type CloudStatusResponse,
} from "@repo/server-contract/cloud";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { toast } from "@repo/ui/components/sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ApiError, queryKeys, unwrap } from "../api";
import { useWorkspace } from "../workspace-context";
import { Row, SectionHeading } from "./settings-chrome";

/**
 * Nothing on the local ws bus announces a sync pass — the bus carries vault,
 * doc and thread invalidations, and sync state is none of those — so this
 * query polls while the dialog is open and stops with it. The dialog body is
 * mounted only while open, which is what makes a poll here honest rather than
 * a background timer nobody asked for.
 */
const STATUS_POLL_MS = 5_000;

function useCloudStatus() {
  const { api } = useWorkspace();
  return useQuery<CloudStatusResponse>({
    queryKey: queryKeys.cloudStatus,
    queryFn: async () => unwrap(await api.cloud.status.$get()),
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

/** The server's own refusal sentence when it sent one; a dropped connection
 *  has none of its own to render. */
function failed(error: unknown, fallback: string): void {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * The two fields as a request, or the sentence that stops it. Pure and total,
 * so the disabled state and the submit read the same answer — a form that lets
 * you press a button it will then refuse to act on is worse than one that
 * never enabled it.
 */
export function readPairDraft(
  code: string,
  deviceName: string,
): { ok: true; request: { code: string; deviceName: string } } | { ok: false; problem: string } {
  const trimmedCode = code.trim();
  const trimmedName = deviceName.trim();
  if (trimmedCode.length === 0) {
    return { ok: false, problem: "Enter the code from your account's Devices page." };
  }
  if (trimmedName.length === 0) {
    return { ok: false, problem: "Name this device so you can recognise it on your account." };
  }
  if (trimmedName.length > CLOUD_DEVICE_NAME_MAX_LENGTH) {
    return {
      ok: false,
      problem: `A device name is at most ${CLOUD_DEVICE_NAME_MAX_LENGTH} characters.`,
    };
  }
  return { ok: true, request: { code: trimmedCode, deviceName: trimmedName } };
}

export interface PairFormProps {
  cloudUrl: string;
  onSubmit: (request: { code: string; deviceName: string }) => void;
  pending: boolean;
}

export function PairForm({ cloudUrl, onSubmit, pending }: PairFormProps) {
  const fieldId = useId();
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const draft = readPairDraft(code, deviceName);

  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.ok && !pending) {
          onSubmit(draft.request);
        }
      }}
    >
      <p className="text-xs text-muted-foreground">
        Sign in at {new URL(cloudUrl).host} and open Devices to mint a one-time code, then enter it
        here. Threads and their history sync; your notes stay in the vault, versioned by git.
      </p>
      <div className="space-y-1">
        <Label htmlFor={`${fieldId}-code`}>Pairing code</Label>
        <Input
          id={`${fieldId}-code`}
          value={code}
          placeholder="ABCD-EFGH"
          autoComplete="off"
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${fieldId}-name`}>This device</Label>
        <Input
          id={`${fieldId}-name`}
          value={deviceName}
          placeholder="Work laptop"
          maxLength={CLOUD_DEVICE_NAME_MAX_LENGTH}
          onChange={(event) => setDeviceName(event.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">{draft.ok ? "" : draft.problem}</p>
      <Button type="submit" size="xs" disabled={!draft.ok || pending}>
        Pair this device
      </Button>
    </form>
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

  const apply = (next: CloudStatusResponse): void => {
    queryClient.setQueryData<CloudStatusResponse>(queryKeys.cloudStatus, () => next);
  };

  const pair = (request: { code: string; deviceName: string }): void => {
    setPending(true);
    void (async () => {
      try {
        apply(await unwrap(await api.cloud.pair.$post({ json: request })));
      } catch (error) {
        failed(error, "Could not pair this device.");
      } finally {
        setPending(false);
      }
    })();
  };

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
      setPending(true);
      try {
        apply(await unwrap(await api.cloud.unpair.$post()));
      } catch (error) {
        failed(error, "Could not unpair this device.");
      } finally {
        setPending(false);
      }
    })();
  };

  const syncNow = (): void => {
    setPending(true);
    void (async () => {
      try {
        apply(await unwrap(await api.cloud.sync.$post()));
      } catch (error) {
        failed(error, "Could not run a sync.");
      } finally {
        setPending(false);
      }
    })();
  };

  const status = statusQuery.data;

  return (
    <section className="space-y-2">
      <SectionHeading>Devices</SectionHeading>
      {status === undefined ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : status.state === "off" ? (
        <PairForm cloudUrl={status.cloudUrl} onSubmit={pair} pending={pending} />
      ) : status.state === "unauthorized" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {status.detail} Sync is stopped. Unpair, then pair again with a fresh code.
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
