"use client";

import { useState } from "react";
import Link from "next/link";
import { z } from "zod";

import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import type { SignUpCodeRequest } from "@repo/contract/account/account-schema";
import { SIGN_IN_PATH } from "@repo/contract/library-page";
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
import { AUTH_FALLBACK_ERROR } from "#lib/auth-client";
import { authPageHref, signedInLanding } from "#lib/next-path";

const refusalSchema = z.looseObject({ message: z.string().min(1) });

const postSignUp = async (path: string, body: SignUpCodeRequest & Record<string, string>) => {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (response.ok) {
    return null;
  }

  const refusal = refusalSchema.safeParse(await response.json().catch(() => null));

  return refusal.success ? refusal.data.message : AUTH_FALLBACK_ERROR;
};

interface Applicant extends SignUpCodeRequest {
  readonly name: string;
}

const DetailsStep = ({
  applicant,
  onSent,
}: {
  applicant: Applicant;
  onSent: (applicant: Applicant) => void;
}) => {
  const { busy, error, onSubmit, ready } = useAuthSubmit(async (form) => {
    const typed = {
      email: fieldValue(form, "email").trim(),
      inviteCode: fieldValue(form, "inviteCode").trim(),
      name: fieldValue(form, "name").trim(),
    } satisfies Applicant;

    const refusal = await postSignUp(AUTH_API_PATHS.signUpCode, {
      email: typed.email,
      inviteCode: typed.inviteCode,
    });

    if (refusal === null) {
      onSent(typed);
    }

    return refusal;
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <AuthField
        id="name"
        name="name"
        label="Name"
        autoComplete="name"
        defaultValue={applicant.name}
        required
        autoFocus
      />
      <AuthField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        defaultValue={applicant.email}
        required
      />
      <AuthField
        id="inviteCode"
        name="inviteCode"
        label="Invite code"
        autoComplete="off"
        spellCheck={false}
        defaultValue={applicant.inviteCode}
        required
      />
      <AuthError message={error} />
      <Button type="submit" disabled={busy || !ready}>
        {busy ? "Sending a code…" : "Email me a code"}
      </Button>
    </form>
  );
};

const NOBODY: Applicant = { email: "", inviteCode: "", name: "" };

export const SignUpForm = ({ next }: { next: string | undefined }) => {
  const [applicant, setApplicant] = useState(NOBODY);
  const [step, setStep] = useState<"details" | "code">("details");

  const { email, inviteCode } = applicant;

  return (
    <AuthShell
      title="Create an account"
      subtitle="Inteligir is invite-only while it's early."
      footer={
        <>
          Already have an account?{" "}
          <Link href={authPageHref(SIGN_IN_PATH, next)} className="underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      {step === "details" ? (
        <DetailsStep
          applicant={applicant}
          onSent={(sent) => {
            setApplicant(sent);
            setStep("code");
          }}
        />
      ) : (
        <SignInCode
          email={email}
          check={async (code) => await postSignUp(AUTH_API_PATHS.signUp, { ...applicant, code })}
          resend={async () => await postSignUp(AUTH_API_PATHS.signUpCode, { email, inviteCode })}
          onAccepted={() => {
            leaveForm(signedInLanding(next));
          }}
          onBack={() => {
            setStep("details");
          }}
        />
      )}
    </AuthShell>
  );
};
