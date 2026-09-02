import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Button } from "@repo/ui/components/button";

import { AuthError, AuthField, AuthShell, fieldValue } from "@/components/auth-shell";
import { authClient, authErrorMessage } from "@/lib/auth-client";

// the emailed link lands on the Worker-hosted form (src/worker/auth/reset-page.ts), which
// must work with no app bundle; this route only requests the link
const RESET_PAGE_PATH = "/auth/reset";

export const Route = createFileRoute("/app/forgot-password")({ component: ForgotPasswordPage });

function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    void (async () => {
      const { error: failure } = await authClient.requestPasswordReset({
        email: fieldValue(form, "email"),
        redirectTo: RESET_PAGE_PATH,
      });
      setBusy(false);
      if (failure !== null) {
        setError(authErrorMessage(failure));
        return;
      }
      setSent(true);
    })();
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <Link to="/app/sign-in" className="underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
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
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
