"use client";

import Link from "next/link";
import { z } from "zod";

import {
  AUTH_API_PATHS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@repo/contract/account/account-schema";
import type { SignUpRequest } from "@repo/contract/account/account-schema";
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
import { AUTH_FALLBACK_ERROR } from "#lib/auth-client";
import { authPageHref, signedInLanding } from "#lib/next-path";

const refusalSchema = z.looseObject({ message: z.string().min(1) });

const refusalMessage = async (response: Response): Promise<string> => {
  const body = refusalSchema.safeParse(await response.json().catch(() => null));
  return body.success ? body.data.message : AUTH_FALLBACK_ERROR;
};

export const SignUpForm = ({ next }: { next: string | undefined }) => {
  const { busy, error, onSubmit, ready } = useAuthSubmit(async (form) => {
    const request: SignUpRequest = {
      email: fieldValue(form, "email"),
      inviteCode: fieldValue(form, "inviteCode"),
      name: fieldValue(form, "name"),
      password: fieldValue(form, "password"),
    };
    // not the Better Auth client: the invite gate forwards Better Auth's answer, cookie included
    const response = await fetch(AUTH_API_PATHS.signUp, {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      return await refusalMessage(response);
    }
    leaveForm(signedInLanding(next));
    return null;
  });

  return (
    <AuthShell
      title="Create an account"
      subtitle="inteligir is invite-only while it's early."
      footer={
        <>
          Already have an account?{" "}
          <Link href={authPageHref(SIGN_IN_PATH, next)} className="underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <AuthField id="name" name="name" label="Name" autoComplete="name" required autoFocus />
        <AuthField
          id="email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
        />
        <AuthField
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <AuthField
          id="inviteCode"
          name="inviteCode"
          label="Invite code"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <AuthError message={error} />
        <Button type="submit" disabled={busy || !ready}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
};
