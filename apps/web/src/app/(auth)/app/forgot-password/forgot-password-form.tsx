"use client";

import Link from "next/link";

import { SIGN_IN_PATH } from "@repo/contract/library-page";
import { Button } from "@repo/ui/components/button";

import { AuthError, AuthField, AuthShell, fieldValue, useAuthSubmit } from "#components/auth-shell";
import { authClient, authErrorMessage } from "#lib/auth-client";
import { authPageHref, resetLanding } from "#lib/next-path";

export const ForgotPasswordForm = ({ next }: { next: string | undefined }) => {
  const { busy, done, error, onSubmit, ready } = useAuthSubmit(async (form) => {
    const { error: failure } = await authClient.requestPasswordReset({
      email: fieldValue(form, "email"),
      redirectTo: resetLanding(next),
    });
    return failure === null ? null : authErrorMessage(failure);
  });

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <Link href={authPageHref(SIGN_IN_PATH, next)} className="underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <p className="text-center text-sm text-muted-foreground">
          If that address has an account, a reset link is on its way.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4">
          <AuthField
            id="email"
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            autoFocus
          />
          <AuthError message={error} />
          <Button type="submit" disabled={busy || !ready}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
};
