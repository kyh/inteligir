"use client";

import { useState } from "react";
import Link from "next/link";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/contract/account/account-schema";
import { SIGN_IN_PATH } from "@repo/contract/library-page";
import { Button } from "@repo/ui/components/button";

import { AuthError, AuthField, AuthShell, fieldValue, useAuthSubmit } from "#components/auth-shell";
import { authClient, authErrorMessage } from "#lib/auth-client";
import { authPageHref } from "#lib/next-path";
import type { ResetView } from "#lib/reset-link";

type SettledView = Exclude<ResetView, { readonly kind: "form" }>;

const SignInLink = ({ label, next }: { label: string; next: string | undefined }) => (
  <Link href={authPageHref(SIGN_IN_PATH, next)} className="underline underline-offset-4">
    {label}
  </Link>
);

const ResetForm = ({
  token,
  next,
  onSettled,
}: {
  token: string;
  next: string | undefined;
  onSettled: (view: SettledView) => void;
}) => {
  const { busy, error, onSubmit, ready } = useAuthSubmit(async (form) => {
    const newPassword = fieldValue(form, "password");

    if (newPassword !== fieldValue(form, "confirm")) {
      return "Passwords don't match.";
    }

    const { error: failure } = await authClient.resetPassword({ newPassword, token });

    if (failure === null) {
      onSettled({ kind: "done" });

      return null;
    }

    if (failure.code === "INVALID_TOKEN") {
      onSettled({ kind: "dead" });

      return null;
    }

    return authErrorMessage(failure);
  });

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="You'll sign in with it from now on."
      footer={<SignInLink label="Back to sign in" next={next} />}
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <AuthField
          id="password"
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          autoFocus
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <AuthField
          id="confirm"
          name="confirm"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          required
        />
        <AuthError message={error} />
        <Button type="submit" disabled={busy || !ready}>
          {busy ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </AuthShell>
  );
};

const PasswordChanged = ({ next }: { next: string | undefined }) => (
  <AuthShell
    title="Password changed"
    subtitle="Sign in with your new password from now on."
    footer={<SignInLink label="Sign in" next={next} />}
  >
    <p className="text-center text-sm text-muted-foreground">
      Every device and browser that was signed in is signed out, and asks for the new password. You
      can close this tab.
    </p>
  </AuthShell>
);

const DeadLink = ({ next }: { next: string | undefined }) => (
  <AuthShell
    title="This link is invalid or has expired"
    subtitle="A reset link works once, and only for a while."
    footer={<SignInLink label="Back to sign in" next={next} />}
  >
    <p className="text-center text-sm">
      <Link
        href={authPageHref("/app/forgot-password", next)}
        className="underline underline-offset-4"
      >
        Send a new link
      </Link>
    </p>
  </AuthShell>
);

export const ResetPasswordForm = ({
  link,
  next,
}: {
  link: ResetView;
  next: string | undefined;
}) => {
  const [view, setView] = useState(link);

  switch (view.kind) {
    case "form": {
      return <ResetForm token={view.token} next={next} onSettled={setView} />;
    }

    case "done": {
      return <PasswordChanged next={next} />;
    }

    case "dead": {
      return <DeadLink next={next} />;
    }

    default: {
      const exhaustive: never = view;

      return exhaustive;
    }
  }
};
