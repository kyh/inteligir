// Not titled "Sync", and its button names threads: the Vault section already
// has a "Sync now" that pushes files. No on/off toggle: the credential on disk
// is the switch, and a second value could disagree with it.

import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { useId, useState } from "react";
import { relativeTimeLabel, useNow } from "../relative-time";
import { useCloudSession } from "../cloud-session";
import { useDataDirScope } from "../vault-hooks";
import { Row, SecondVaultNote, SectionHeading } from "./settings-chrome";

const lastSyncedLabel = (epochMs: number | null, nowMs: number): string =>
  epochMs === null ? "never" : relativeTimeLabel(epochMs, nowMs, { seconds: true });

// Must match the seconds tier above, or "40s ago" freezes until the minute tick.
const LAST_SYNCED_TICK_MS = 1000;

export interface SignInFormProps {
  cloudUrl: string;
  onSignIn: (login: { email: string; password: string }) => void;
  pending: boolean;
  // the cloud's own words for why it said no, shown beside the fields it applies to
  refusal: string | null;
}

export const SignInForm = ({ cloudUrl, onSignIn, pending, refusal }: SignInFormProps) => {
  const formId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const ready = email.trim() !== "" && password !== "";

  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !pending) {
          onSignIn({ email, password });
        }
      }}
    >
      <p className="text-xs text-muted-foreground">
        Sign in with your {new URL(cloudUrl).host} account. Your threads and your vault then sync
        through it — unless this machine is configured with its own git remote.
      </p>
      <div className="flex items-center gap-2">
        <Label htmlFor={`${formId}-email`} className="w-24 shrink-0 text-xs">
          Email
        </Label>
        <Input
          id={`${formId}-email`}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={`${formId}-password`} className="w-24 shrink-0 text-xs">
          Password
        </Label>
        <Input
          id={`${formId}-password`}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </div>
      {refusal === null ? null : <p className="text-xs text-destructive">{refusal}</p>}
      <Button type="submit" size="compact" disabled={pending || !ready}>
        Sign in
      </Button>
    </form>
  );
};

export interface SignedInDetailsProps {
  status: Extract<CloudStatusResponse, { state: "signed-in" }>;
  nowMs: number;
}

export const SignedInDetails = ({ status, nowMs }: SignedInDetailsProps) => (
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

export const SyncSection = () => {
  const { status, pending, refusal, signIn, signOut, syncThreads } = useCloudSession();
  const now = useNow(LAST_SYNCED_TICK_MS);
  const scope = useDataDirScope();

  const body = () => {
    if (status === undefined) {
      return <p className="text-sm text-muted-foreground">…</p>;
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
          <p className="text-xs text-muted-foreground">
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
