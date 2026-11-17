"use client";

import Link from "next/link";

import { Button } from "@repo/ui/components/button";

import {
  AuthError,
  AuthField,
  AuthShell,
  fieldValue,
  leaveForm,
  useAuthSubmit,
} from "#components/auth-shell";
import { authClient, authErrorMessage } from "#lib/auth-client";
import { authPageHref, signedInLanding } from "#lib/next-path";
import { siteConfig } from "#lib/site-config";

export const SignInForm = ({ next }: { next: string | undefined }) => {
  const { busy, error, onSubmit, ready } = useAuthSubmit(async (form) => {
    const { error: failure } = await authClient.signIn.email({
      email: fieldValue(form, "email"),
      password: fieldValue(form, "password"),
    });
    if (failure !== null) {
      return authErrorMessage(failure);
    }
    leaveForm(signedInLanding(next));
    return null;
  });

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
        <AuthField
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
        />
        <AuthError message={error} />
        <Button type="submit" disabled={busy || !ready}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <Link
          href={authPageHref("/app/forgot-password", next)}
          className="text-center text-xs text-muted-foreground underline underline-offset-4"
        >
          Forgot your password?
        </Link>
      </form>
    </AuthShell>
  );
};
