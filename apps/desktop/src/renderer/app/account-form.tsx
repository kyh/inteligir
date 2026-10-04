// The one account form, which the rail's dialog, Settings › Account and the first run's account
// step draw over `useCloudSession`. Creating the account signs this device in with it, so nobody
// meets a second sign-in right after the first.

import {
  CLOUD_PASSWORD_MAX_LENGTH,
  CLOUD_PASSWORD_MIN_LENGTH,
  cloudForgotPasswordPageUrl,
} from "@repo/contract/local/cloud/cloud-schema";
import type { VaultStatusResponse } from "@repo/contract/local/vault/vault-schema";
import { Button } from "@repo/ui/components/button";
import { useId, useState } from "react";
import { accountOffer } from "./account-offer";
import type { CloudSession } from "./cloud-session";
import { LabelledField } from "./labelled-field";

type AccountFormMode = "sign-in" | "create";

export interface AccountFormProps {
  cloudUrl: string;
  session: Pick<CloudSession, "pending" | "refusal" | "signIn" | "signUp">;
  // what an account does for these notes depends on where they already sync, so the form says
  // nothing of it until the vault's status is known
  vault: VaultStatusResponse | undefined;
  // absent, sign-in: only a first run meets someone who most likely has an invite and no account
  initialMode?: AccountFormMode;
}

export const AccountForm = ({
  cloudUrl,
  session,
  vault,
  initialMode = "sign-in",
}: AccountFormProps) => {
  const formId = useId();
  const [mode, setMode] = useState<AccountFormMode>(initialMode);
  // a refusal answers the mode it was asked in; switched away, it would sit under the wrong fields
  const [askedIn, setAskedIn] = useState<AccountFormMode | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const { pending, refusal } = session;
  const creating = mode === "create";
  const ready =
    email.trim() !== "" &&
    password !== "" &&
    (!creating || (name.trim() !== "" && inviteCode.trim() !== ""));

  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || pending) {
          return;
        }
        setAskedIn(mode);
        if (creating) {
          session.signUp({ email, inviteCode, name, password });
        } else {
          session.signIn({ email, password });
        }
      }}
    >
      {vault === undefined ? null : (
        <p className="text-body text-muted-foreground">{accountOffer(vault).lead}</p>
      )}
      {creating ? (
        <LabelledField
          id={`${formId}-name`}
          label="Name"
          autoComplete="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      ) : null}
      <LabelledField
        id={`${formId}-email`}
        label="Email"
        type="email"
        autoComplete={creating ? "email" : "username"}
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
      />
      <LabelledField
        id={`${formId}-password`}
        label="Password"
        type="password"
        autoComplete={creating ? "new-password" : "current-password"}
        minLength={creating ? CLOUD_PASSWORD_MIN_LENGTH : undefined}
        maxLength={CLOUD_PASSWORD_MAX_LENGTH}
        placeholder={creating ? `At least ${CLOUD_PASSWORD_MIN_LENGTH} characters` : undefined}
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
      />
      {creating ? (
        <LabelledField
          id={`${formId}-invite`}
          label="Invite code"
          autoComplete="off"
          spellCheck={false}
          value={inviteCode}
          onChange={(event) => {
            setInviteCode(event.target.value);
          }}
        />
      ) : null}
      {refusal === null || askedIn !== mode ? null : (
        <p className="text-body text-destructive">{refusal}</p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="compact" disabled={pending || !ready}>
          {creating ? "Create account" : "Sign in"}
        </Button>
        <Button
          type="button"
          size="compact"
          variant="ghost"
          onClick={() => {
            setMode(creating ? "sign-in" : "create");
          }}
        >
          {creating ? "I have an account" : "Create an account"}
        </Button>
        {creating ? null : (
          <a
            href={cloudForgotPasswordPageUrl(cloudUrl)}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-body text-muted-foreground underline-offset-2 hover:underline"
          >
            Forgot password?
          </a>
        )}
      </div>
    </form>
  );
};
