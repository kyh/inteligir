import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Button } from "@repo/ui/components/button";

import { AuthError, AuthField, AuthShell, fieldValue } from "@/components/auth-shell";
import { authClient, authErrorMessage } from "@/lib/auth-client";

// Where the emailed link's GET leg redirects: the Worker-hosted reset form
// (src/worker/auth/reset-page.ts), which is the ONE page that sets a new
// password. It stays server-rendered and static on purpose — a reset has to
// work from any device, from an email client, with no app bundle to download —
// so this route requests the link and never duplicates the form behind it.
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
        // Deliberately says nothing about whether that address has an account:
        // the server's answer is neutral, and so is this.
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
