"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";

import { Button } from "@repo/ui/components/button";

import {
  AuthError,
  AuthField,
  AuthShell,
  fieldValue,
  leaveForm,
  useAuthSubmit,
} from "#components/auth-shell";
import { SignInCode } from "#components/sign-in-code";
import { authClient, authErrorMessage } from "#lib/auth-client";
import { authPageHref, signedInLanding } from "#lib/next-path";
import { siteConfig } from "#lib/site-config";

const handedOffSchema = z.object({ redirect: z.literal(true), url: z.string() });

const sendCode = async (email: string) => {
  const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });

  return error === null ? null : authErrorMessage(error);
};

const EmailStep = ({ email, onSent }: { email: string; onSent: (email: string) => void }) => {
  const { busy, error, onSubmit, ready } = useAuthSubmit(async (form) => {
    const typed = fieldValue(form, "email").trim();
    const refusal = await sendCode(typed);

    if (refusal === null) {
      onSent(typed);
    }

    return refusal;
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <AuthField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        defaultValue={email}
        required
        autoFocus
      />
      <AuthError message={error} />
      <Button type="submit" disabled={busy || !ready}>
        {busy ? "Sending a code…" : "Email me a code"}
      </Button>
    </form>
  );
};

export const SignInForm = ({ next }: { next: string | undefined }) => {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const handedOff = useRef(false);

  const check = async (otp: string) => {
    const { data, error } = await authClient.signIn.emailOtp({ email, otp });

    if (error !== null) {
      return authErrorMessage(error);
    }

    handedOff.current = handedOffSchema.safeParse(data).success;

    return null;
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle={siteConfig.description}
      footer={
        <>
          No account?{" "}
          <Link href={authPageHref("/app/sign-up", next)} className="underline underline-offset-4">
            Sign up
          </Link>
        </>
      }
    >
      {step === "email" ? (
        <EmailStep
          email={email}
          onSent={(sent) => {
            setEmail(sent);
            setStep("code");
          }}
        />
      ) : (
        <SignInCode
          email={email}
          check={check}
          resend={async () => await sendCode(email)}
          onAccepted={() => {
            if (!handedOff.current) {
              leaveForm(signedInLanding(next));
            }
          }}
          onBack={() => {
            setStep("email");
          }}
        />
      )}
    </AuthShell>
  );
};
