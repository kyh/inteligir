// The Mac app's first run: sign in, or create the account with an invite code. Either answers this
// device's own credential, which the shell keeps in the Keychain before the page opens the
// library; a credential nobody could keep is given back, so it holds no slot of the account's
// device cap. The browser tab has no screen of this: it signs in on the site.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@repo/contract/cloud/device/device-schema";
import type { DeviceLoginResponse } from "@repo/contract/cloud/device/device-schema";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ComponentProps } from "react";

import type { ShellConfig } from "../../shell/shell-config";
import { shellCredential } from "../../shell/shell-commands";
import { NEEDS_CONNECTION, refusalText } from "./needs-connection";
import { macTransport } from "./shell-library";

type Mode = "sign-in" | "create";

interface Typed {
  readonly email: string;
  readonly inviteCode: string;
  readonly mode: Mode;
  readonly name: string;
  readonly password: string;
}

const clientOf = (config: ShellConfig, credential: string | null): V1Client => {
  const transport = macTransport(config, credential);
  return createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => await transport.fetch(new Request(url, init)),
      origin: transport.origin,
      url: V1_RPC_PATH,
    }),
  );
};

// the sign-in's answer kept in the Keychain; one the shell could not keep is signed out again, its
// slot given back, and the shell's own words said
export const keepSignIn = async (
  config: ShellConfig,
  answer: DeviceLoginResponse,
): Promise<void> => {
  try {
    await shellCredential.keep({
      credential: {
        credential: answer.credential,
        deviceId: answer.deviceId,
        email: answer.email,
        userId: answer.userId,
      },
    });
  } catch (error) {
    try {
      await clientOf(config, answer.credential).account.signOut();
    } catch {
      // the cloud did not take the sign-out either; the device list shows the slot to free
    }
    throw error;
  }
};

const signIn = async (config: ShellConfig, typed: Typed): Promise<DeviceLoginResponse> => {
  const { account } = clientOf(config, null);
  const answer =
    typed.mode === "create"
      ? await account.signUp({
          deviceName: config.deviceName,
          email: typed.email,
          inviteCode: typed.inviteCode,
          name: typed.name,
          password: typed.password,
        })
      : await account.signIn({
          deviceName: config.deviceName,
          email: typed.email,
          password: typed.password,
        });
  await keepSignIn(config, answer);
  return answer;
};

const Field = ({ id, label, ...input }: ComponentProps<typeof Input> & { label: string }) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} {...input} />
  </div>
);

const SignInForm = ({ config, onSignedIn }: { config: ShellConfig; onSignedIn: () => void }) => {
  const formId = useId();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const asked = useMutation({
    mutationFn: async (typed: Typed) => await signIn(config, typed),
    onSuccess: onSignedIn,
  });
  const creating = mode === "create";
  const ready =
    email.trim() !== "" &&
    password.length >= PASSWORD_MIN_LENGTH &&
    (!creating || (name.trim() !== "" && inviteCode.trim() !== ""));
  // a refusal answers the mode it was asked in; switched away, it would sit under the wrong fields
  const refusal =
    asked.isError && asked.variables.mode === mode
      ? refusalText(asked.error, "That didn't work. Try again.")
      : null;

  return (
    <form
      aria-label={creating ? "Create your account" : "Sign in"}
      className="flex w-full max-w-sm flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !asked.isPending) {
          asked.mutate({ email, inviteCode, mode, name, password });
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-display font-semibold">
          {creating ? "Create your account" : "Sign in to your library"}
        </h1>
        <p className="m-0 text-body text-muted-foreground">
          Your library lives in your account, and this Mac keeps a copy you can read and edit
          offline.
        </p>
      </div>
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
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        placeholder={creating ? `At least ${String(PASSWORD_MIN_LENGTH)} characters` : undefined}
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
      {asked.isPaused ? (
        <p className="m-0 text-body text-muted-foreground" data-needs-connection>
          {NEEDS_CONNECTION}
        </p>
      ) : null}
      {refusal === null ? null : <p className="m-0 text-body text-destructive">{refusal}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={asked.isPending || !ready}>
          {creating ? "Create account" : "Sign in"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setMode(creating ? "sign-in" : "create");
          }}
        >
          {creating ? "I have an account" : "Create an account"}
        </Button>
      </div>
      {creating ? null : (
        <a
          href={`${config.cloudOrigin}/app/forgot-password`}
          target="_blank"
          rel="noreferrer"
          className="text-body text-muted-foreground underline-offset-2 hover:underline"
        >
          Forgot your password?
        </a>
      )}
    </form>
  );
};

export const SignInPage = ({
  config,
  onSignedIn,
  queryClient,
}: {
  config: ShellConfig;
  onSignedIn: () => void;
  // the page's own client: the sign-in waits offline and goes when the connection does
  queryClient: QueryClient;
}) => (
  <QueryClientProvider client={queryClient}>
    <main className="flex min-h-dvh items-center justify-center p-8" data-tauri-drag-region>
      <SignInForm config={config} onSignedIn={onSignedIn} />
    </main>
  </QueryClientProvider>
);
