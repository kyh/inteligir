// Not titled "Sync": the Vault section already has a "Sync now". No on/off toggle: the credential
// on disk is the switch, and a second value could disagree with it. The thread sync's own state
// and its last error are Settings › Advanced's.

import { cloudDevicesPageUrl } from "@repo/api/local/cloud/cloud-schema";
import { Button } from "@repo/ui/components/button";
import { AccountForm } from "../account-form";
import { useCloudSession } from "../cloud-session";
import { useDataDirScope } from "../vault-hooks";
import { Row, SecondVaultNote, SectionHeading } from "./settings-chrome";

export const RevokeFailedNotice = ({ cloudUrl }: { cloudUrl: string }) => {
  const devicesUrl = cloudDevicesPageUrl(cloudUrl);
  return (
    <p className="text-body text-muted-foreground">
      This device could not remove itself from your account. Remove it from Devices at{" "}
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

export const SyncSection = () => {
  const { status, pending, refusal, signIn, signOut, signUp } = useCloudSession();
  const scope = useDataDirScope();

  const body = () => {
    if (status === undefined) {
      return <p className="text-subtitle text-muted-foreground">…</p>;
    }
    if (status.state === "signed-out") {
      return (
        <div className="space-y-2">
          <SecondVaultNote scope={scope} />
          {status.revokeError === null ? null : <RevokeFailedNotice cloudUrl={status.cloudUrl} />}
          <AccountForm
            cloudUrl={status.cloudUrl}
            onCreate={signUp}
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
        <dl className="space-y-1.5">
          <Row label="Account">
            <span className="block truncate font-mono text-body">
              {status.accountEmail ?? new URL(status.cloudUrl).host}
            </span>
          </Row>
        </dl>
        <Button size="compact" variant="ghost" onClick={signOut} disabled={pending}>
          Sign out
        </Button>
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
