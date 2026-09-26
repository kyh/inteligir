// The engine's own words, raw, for whoever brings their own sync server or sends a report: the
// rail, a toast and every other section speak only sync, so this is the one place that shows the
// remote, a raw state and the last error verbatim.

import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import type { SystemStatusResponse } from "@repo/api/local/system/system-schema";
import { externalSyncName } from "@repo/api/local/vault/vault-schema";
import type { VaultStatusResponse } from "@repo/api/local/vault/vault-schema";
import { describeSyncConflict } from "@repo/notes/sync/conflict-copy";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { Switch } from "@repo/ui/components/switch";
import { plural } from "@repo/ui/lib/plural";
import { useState } from "react";
import type { DiagnosticsState } from "../../../diagnostics-state";
import { useCloudSession } from "../cloud-session";
import {
  openDataFolder,
  restartApp,
  setDebugLogging,
  showServerLog,
  useDesktopDiagnostics,
} from "../desktop-diagnostics";
import { relativeTimeLabel, useNow } from "../relative-time";
import { useSystemStatus, useVaultStatus } from "../vault-hooks";
import { bridgeFailed, Row, SectionHeading } from "./settings-chrome";
import { SyncRemoteRow } from "./sync-remote-row";

// the seconds tier of the label, or "40s ago" freezes until the minute tick
const LAST_SYNC_TICK_MS = 1000;

const lastSyncLabel = (epochMs: number | null, nowMs: number): string =>
  epochMs === null ? "never" : relativeTimeLabel(epochMs, nowMs, { seconds: true });

const Raw = ({ children, title }: { children: React.ReactNode; title?: string | undefined }) => (
  <span className="block truncate font-mono text-body" title={title}>
    {children}
  </span>
);

// wrapped, never truncated: an error is read whole or not at all
const RawError = ({ error }: { error: string | null }) => (
  <span className="block font-mono text-body break-words whitespace-pre-wrap text-muted-foreground">
    {error ?? "None"}
  </span>
);

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <h4 className="text-caption font-medium text-muted-foreground">{title}</h4>
    {children}
  </div>
);

const Waiting = () => <p className="text-subtitle text-muted-foreground">…</p>;

export const VaultSyncRows = ({
  status,
  nowMs,
}: {
  status: VaultStatusResponse | undefined;
  nowMs: number;
}) => {
  if (status === undefined) {
    return <Waiting />;
  }
  return (
    <dl className="space-y-1.5">
      <Row label="State">
        <Raw>{status.state}</Raw>
      </Row>
      {status.state === "no-remote" ? (
        <Row label="Remote">
          <span className="text-body text-muted-foreground">
            {status.externalSync === null
              ? "None — sign in under Devices to sync through your account, or choose your own git server above."
              : `None — ${externalSyncName(status.externalSync)} syncs this folder, so the hosted vault stays off; your own git server, chosen above, still syncs.`}
          </span>
        </Row>
      ) : (
        <>
          <Row label="Remote">
            <Raw title={status.remote}>{status.remote}</Raw>
          </Row>
          <Row label="Source">
            <Raw>{status.remoteSource}</Raw>
          </Row>
        </>
      )}
      <Row label="Last sync">
        <span className="text-body">{lastSyncLabel(status.lastSyncAt, nowMs)}</span>
      </Row>
      <Row label="Last error">
        <RawError error={status.lastError} />
      </Row>
      <Row label="Device">
        <Raw title={status.device}>{status.device}</Raw>
      </Row>
      {status.conflicts.length > 0 ? (
        <Row label="Conflicts">
          <ul className="space-y-0.5">
            {status.conflicts.map((report) => (
              <li
                key={`${String(report.at)}:${report.kind === "copied" ? report.copyPath : report.path}`}
                className="text-body text-muted-foreground"
              >
                {describeSyncConflict(report, { thisDevice: status.device })}
              </li>
            ))}
          </ul>
        </Row>
      ) : null}
    </dl>
  );
};

export interface ThreadSyncRowsProps {
  status: CloudStatusResponse | undefined;
  nowMs: number;
  pending: boolean;
  onSync: () => void;
}

export const ThreadSyncRows = ({ status, nowMs, pending, onSync }: ThreadSyncRowsProps) => {
  if (status === undefined) {
    return <Waiting />;
  }
  switch (status.state) {
    case "signed-out": {
      return (
        <dl className="space-y-1.5">
          <Row label="State">
            <Raw>{status.state}</Raw>
          </Row>
        </dl>
      );
    }
    case "unauthorized": {
      return (
        <dl className="space-y-1.5">
          <Row label="State">
            <Raw>{status.state}</Raw>
          </Row>
          <Row label="Device">
            <Raw>{status.deviceId}</Raw>
          </Row>
          <Row label="Reason">
            <RawError error={status.detail} />
          </Row>
        </dl>
      );
    }
    case "signed-in": {
      return (
        <div className="space-y-2">
          <dl className="space-y-1.5">
            <Row label="State">
              <Raw>
                {status.state} · {status.connected ? "following" : "polling"}
              </Raw>
            </Row>
            <Row label="Device">
              <Raw>{status.deviceId}</Raw>
            </Row>
            <Row label="Queued">
              <span className="text-body">{plural(status.pending, "event")}</span>
            </Row>
            <Row label="Dropped">
              <span className="text-body">
                {status.dropped === 0
                  ? "None"
                  : `${plural(status.dropped, "event")} never reached the cloud`}
              </span>
            </Row>
            <Row label="Cursor">
              <Raw>{status.cursor}</Raw>
            </Row>
            <Row label="Last sync">
              <span className="text-body">{lastSyncLabel(status.lastSyncedAt, nowMs)}</span>
            </Row>
            <Row label="Last error">
              <RawError error={status.lastError} />
            </Row>
          </dl>
          <Button size="compact" variant="tertiary" disabled={pending} onClick={onSync}>
            Sync threads now
          </Button>
        </div>
      );
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

type OwnedDiagnostics = Extract<DiagnosticsState, { server: "owned" }>;

const debugNote = (state: OwnedDiagnostics): string => {
  if (!state.restartRequired) {
    return state.debug
      ? "Every file change, index pass, sync step and agent message is traced into the log."
      : "Off.";
  }
  return state.canRestart
    ? "Takes effect when the app restarts."
    : "Takes effect once you quit and reopen the app.";
};

// rendered only under the shell: a browser tab did not start the server it talks to
const DebugLoggingRows = ({ state }: { state: DiagnosticsState }) => {
  const [pending, setPending] = useState(false);
  const run = (work: () => Promise<string | null>): void => {
    setPending(true);
    void (async () => {
      try {
        const refusal = await work();
        if (refusal !== null) {
          toast.error(refusal);
        }
      } catch (error) {
        bridgeFailed(error, "The app did not answer.");
      }
      setPending(false);
    })();
  };
  return (
    <>
      <Row label="Debug logging">
        {state.server === "adopted" ? (
          <span className="text-subtitle text-muted-foreground">{state.reason}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <Switch
              aria-label="Debug logging"
              checked={state.debug}
              disabled={pending}
              onCheckedChange={(debug) => {
                run(async () => await setDebugLogging(debug));
              }}
            />
            <span className="text-subtitle text-muted-foreground">{debugNote(state)}</span>
            {state.restartRequired && state.canRestart ? (
              <Button
                variant="tertiary"
                size="compact"
                disabled={pending}
                onClick={() => {
                  run(restartApp);
                }}
              >
                Restart Inteligir
              </Button>
            ) : null}
          </span>
        )}
      </Row>
      <Row label="Log">
        <Button variant="tertiary" size="compact" onClick={showServerLog}>
          Show log
        </Button>
      </Row>
    </>
  );
};

export const DiagnosticsRows = ({ system }: { system: SystemStatusResponse | undefined }) => {
  const shell = useDesktopDiagnostics();
  return (
    <dl className="space-y-1.5">
      <Row label="Data folder">
        <Raw title={system?.dataDir}>{system?.dataDir ?? "…"}</Raw>
        {shell.kind === "state" ? (
          <Button variant="tertiary" size="compact" className="mt-1" onClick={openDataFolder}>
            Open data folder
          </Button>
        ) : null}
      </Row>
      <Row label="Schema">
        <Raw>{system === undefined ? "…" : `v${system.schemaVersion}`}</Raw>
      </Row>
      <Row label="Uptime">
        <Raw>{system === undefined ? "…" : `${Math.round(system.uptimeMs / 1000)}s`}</Raw>
      </Row>
      {shell.kind === "state" ? <DebugLoggingRows state={shell.state} /> : null}
    </dl>
  );
};

export const AdvancedSection = () => {
  const vault = useVaultStatus().data;
  const system = useSystemStatus().data;
  const { status: cloud, pending, syncThreads } = useCloudSession();
  const now = useNow(LAST_SYNC_TICK_MS);

  return (
    <section className="space-y-4">
      <SectionHeading>Advanced</SectionHeading>
      <Group title="Vault sync">
        <dl>
          <SyncRemoteRow status={vault} />
        </dl>
        <VaultSyncRows status={vault} nowMs={now} />
      </Group>
      <Group title="Thread sync">
        <ThreadSyncRows status={cloud} nowMs={now} pending={pending} onSync={syncThreads} />
      </Group>
      <Group title="Diagnostics">
        <DiagnosticsRows system={system} />
      </Group>
    </section>
  );
};
