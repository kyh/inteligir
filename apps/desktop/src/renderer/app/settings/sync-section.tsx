// Not titled "Sync", and its button names threads: the Vault section already
// has a "Sync now" that pushes files. No on/off toggle: the credential on disk
// is the switch, and a second value could disagree with it.

import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import { Button } from "@repo/ui/components/button";
import { relativeTimeLabel, useNow } from "../relative-time";
import { useCloudSession } from "../cloud-session";
import { SignInForm } from "../sign-in-form";
import { useDataDirScope } from "../vault-hooks";
import { Row, SecondVaultNote, SectionHeading } from "./settings-chrome";

const lastSyncedLabel = (epochMs: number | null, nowMs: number): string =>
  epochMs === null ? "never" : relativeTimeLabel(epochMs, nowMs, { seconds: true });

// Must match the seconds tier above, or "40s ago" freezes until the minute tick.
const LAST_SYNCED_TICK_MS = 1000;

export interface SignedInDetailsProps {
  status: Extract<CloudStatusResponse, { state: "signed-in" }>;
  nowMs: number;
}

export const SignedInDetails = ({ status, nowMs }: SignedInDetailsProps) => (
  <dl className="space-y-1.5">
    <Row label="Account">
      <span className="block truncate font-mono text-body">
        {status.accountEmail ?? new URL(status.cloudUrl).host}
      </span>
    </Row>
    <Row label="Device">
      <span className="block truncate font-mono text-body">{status.deviceId}</span>
    </Row>
    <Row label="State">
      <span className="text-body">
        {status.connected ? "Following" : "Polling"} · {status.pending} queued · synced{" "}
        {lastSyncedLabel(status.lastSyncedAt, nowMs)}
      </span>
    </Row>
    {status.lastError === null ? null : (
      <Row label="Last error">
        <span className="text-body text-muted-foreground">{status.lastError}</span>
      </Row>
    )}
  </dl>
);

export const SyncSection = () => {
  const { status, pending, refusal, signIn, signOut, syncThreads } = useCloudSession();
  const now = useNow(LAST_SYNCED_TICK_MS);
  const scope = useDataDirScope();

  const body = () => {
    if (status === undefined) {
      return <p className="text-subtitle text-muted-foreground">…</p>;
    }
    if (status.state === "signed-out") {
      return (
        <div className="space-y-2">
          <SecondVaultNote scope={scope} />
          <SignInForm
            cloudUrl={status.cloudUrl}
            onSignIn={signIn}
            pending={pending}
            refusal={refusal}
          />
        </div>
      );
    }
    if (status.state === "unauthorized") {
      return (
        <div className="space-y-2">
          <p className="text-body text-muted-foreground">
            {status.detail} Sync is stopped. Sign this device out, then sign it in again.
          </p>
          <Button size="compact" variant="tertiary" onClick={signOut} disabled={pending}>
            Sign out
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <SignedInDetails status={status} nowMs={now} />
        <div className="flex gap-2">
          <Button size="compact" variant="tertiary" disabled={pending} onClick={syncThreads}>
            Sync threads now
          </Button>
          <Button size="compact" variant="ghost" onClick={signOut} disabled={pending}>
            Sign out
          </Button>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-2">
      <SectionHeading>Devices</SectionHeading>
      {body()}
    </section>
  );
};
