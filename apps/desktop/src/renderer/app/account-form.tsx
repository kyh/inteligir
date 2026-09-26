// The one account form, which the rail's dialog, Settings › Account and the first run's account
// step draw over `useCloudSession`. Creating the account signs this device in with it, so nobody
// meets a second sign-in right after the first.

import {
  CLOUD_PASSWORD_MAX_LENGTH,
  CLOUD_PASSWORD_MIN_LENGTH,
  cloudForgotPasswordPageUrl,
} from "@repo/api/local/cloud/cloud-schema";
import type { CloudLoginRequest, CloudSignUpRequest } from "@repo/api/local/cloud/cloud-schema";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import type { ComponentProps } from "react";
import { useId, useState } from "react";

type AccountFormMode = "sign-in" | "create";

export interface AccountFormProps {
  cloudUrl: string;
  onSignIn: (request: CloudLoginRequest) => void;
  onCreate: (request: CloudSignUpRequest) => void;
  pending: boolean;
  // the cloud's own words for why it said no, shown beside the fields it applies to
  refusal: string | null;
  // absent, sign-in: only a first run meets someone who most likely has an invite and no account
  initialMode?: AccountFormMode;
  // in place of the form's own sentence, which promises the notes start syncing: a surface that
  // knows the vault says what an account does for it
  lead?: string;
}

const Field = ({ id, label, ...input }: { label: string } & ComponentProps<typeof Input>) => (
  <div className="flex items-center gap-2">
    <Label htmlFor={id} className="w-24 shrink-0 text-body">
      {label}
    </Label>
    <Input id={id} {...input} />
  </div>
);

export const AccountForm = ({
  cloudUrl,
  onCreate,
  onSignIn,
  pending,
  refusal,
  initialMode = "sign-in",
  lead,
}: AccountFormProps) => {
  const formId = useId();
  const [mode, setMode] = useState<AccountFormMode>(initialMode);
  // a refusal answers the mode it was asked in; switched away, it would sit under the wrong fields
  const [askedIn, setAskedIn] = useState<AccountFormMode | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const creating = mode === "create";
  const { host } = new URL(cloudUrl);
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
          onCreate({ email, inviteCode, name, password });
        } else {
          onSignIn({ email, password });
        }
      }}
    >
      <p className="text-body text-muted-foreground">
        {lead ??
          (creating
            ? `Create a ${host} account with your invite code. This device signs in to it right away, and your notes start syncing.`
            : `Sign in with your ${host} account to sync your notes between your devices.`)}
      </p>
      {creating ? (
        <Field
          id={`${formId}-name`}
          label="Name"
          autoComplete="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      ) : null}
      <Field
        id={`${formId}-email`}
        label="Email"
        type="email"
        autoComplete={creating ? "email" : "username"}
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
      />
      <Field
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
        <Field
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
