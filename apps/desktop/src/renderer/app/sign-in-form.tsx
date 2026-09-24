// The device sign-in both the rail's dialog and Settings › Devices draw, over `useCloudSession`.

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { useId, useState } from "react";

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
      <p className="text-body text-muted-foreground">
        Sign in with your {new URL(cloudUrl).host} account. Your threads and your vault then sync
        through it — unless this machine is configured with its own git remote.
      </p>
      <div className="flex items-center gap-2">
        <Label htmlFor={`${formId}-email`} className="w-24 shrink-0 text-body">
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
        <Label htmlFor={`${formId}-password`} className="w-24 shrink-0 text-body">
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
      {refusal === null ? null : <p className="text-body text-destructive">{refusal}</p>}
      <Button type="submit" size="compact" disabled={pending || !ready}>
        Sign in
      </Button>
    </form>
  );
};
