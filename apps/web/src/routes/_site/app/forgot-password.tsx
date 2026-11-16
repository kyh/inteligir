import { createFileRoute, Link } from "@tanstack/react-router";

import { Button } from "@repo/ui/components/button";

import { AuthError, AuthField, AuthShell, fieldValue, useAuthSubmit } from "#components/auth-shell";
import { authClient, authErrorMessage } from "#lib/auth-client";
import { authPageSearchSchema, resetLanding } from "#lib/next-path";

const ForgotPasswordPage = () => {
  const { next } = Route.useSearch();
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
        <Link to="/app/sign-in" search={{ next }} className="underline underline-offset-4">
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

export const Route = createFileRoute("/_site/app/forgot-password")({
  validateSearch: authPageSearchSchema,
  component: ForgotPasswordPage,
});
