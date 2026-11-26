"use client";

import { useState } from "react";

import { SIGN_IN_CODE_LENGTH } from "@repo/contract/account/account-schema";
import { OTPInput } from "@repo/ui/components/otp-input";

import { AuthError, CONNECTION_FAILED } from "#components/auth-shell";

type Refusal = string | null;

const LINK_BUTTON =
  "text-xs text-muted-foreground underline underline-offset-4 disabled:opacity-50";

/** The second step of signing in or up: the code mailed to `email`, typed into digit boxes. */
export const SignInCode = ({
  email,
  check,
  resend,
  onAccepted,
  onBack,
}: {
  email: string;
  check: (code: string) => Promise<Refusal>;
  resend: () => Promise<Refusal>;
  onAccepted: () => void;
  onBack: () => void;
}) => {
  const [error, setError] = useState<Refusal>(null);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  const verify = async (code: string) => {
    setError(null);
    const refusal = await check(code).catch(() => CONNECTION_FAILED);
    setError(refusal);

    return refusal === null;
  };

  const sendAgain = async () => {
    setResending(true);
    setResent(false);
    const refusal = await resend().catch(() => CONNECTION_FAILED);
    setResending(false);
    setError(refusal);
    setResent(refusal === null);
  };

  return (
    <div className="grid gap-4">
      <p className="text-center text-sm text-muted-foreground">
        We sent a {SIGN_IN_CODE_LENGTH}-digit code to{" "}
        <span className="text-foreground">{email}</span>.
      </p>
      <label htmlFor="code" className="sr-only">
        Sign-in code
      </label>
      <OTPInput
        id="code"
        name="code"
        length={SIGN_IN_CODE_LENGTH}
        group
        autoFocus
        verify={verify}
        onSuccess={onAccepted}
      />
      <AuthError message={error} />
      {resent ? (
        <output className="block text-center text-xs text-muted-foreground">
          Sent a new code.
        </output>
      ) : null}
      <div className="flex justify-between">
        <button type="button" className={LINK_BUTTON} onClick={onBack}>
          Use a different email
        </button>
        <button
          type="button"
          className={LINK_BUTTON}
          disabled={resending}
          onClick={() => {
            void sendAgain();
          }}
        >
          {resending ? "Sending…" : "Send a new code"}
        </button>
      </div>
    </div>
  );
};
