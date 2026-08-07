import { useState } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";

import { Button } from "@repo/ui/components/button";

import { AuthError, AuthField, AuthShell, fieldValue } from "@/components/auth-shell";
import { currentSession } from "@/lib/session-guard";

// Sign-up does NOT go through the Better Auth client: this deployment is
// invite-only, and the gate is a Worker route in front of Better Auth's own
// sign-up (src/worker/auth/invite.ts). It answers with Better Auth's response
// untouched, so success sets the same session cookie a direct sign-up would.
const SIGN_UP_URL = "/v1/auth/sign-up";

const FALLBACK_ERROR = "Something went wrong — try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The refusal to show. Both this route's gate and Better Auth answer with a
 * `message`, so one reader serves both. */
async function refusalMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = isRecord(body) ? body["message"] : null;
    return typeof message === "string" && message !== "" ? message : FALLBACK_ERROR;
  } catch {
    return FALLBACK_ERROR;
  }
}

export const Route = createFileRoute("/app/sign-up")({
  beforeLoad: async () => {
    if ((await currentSession()) !== null) throw redirect({ to: "/app" });
  },
  component: SignUpPage,
});

function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    void (async () => {
      const response = await fetch(SIGN_UP_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: fieldValue(form, "name"),
          email: fieldValue(form, "email"),
          password: fieldValue(form, "password"),
          inviteCode: fieldValue(form, "inviteCode"),
        }),
      });
      if (!response.ok) {
        setError(await refusalMessage(response));
        setBusy(false);
        return;
      }
      await router.navigate({ to: "/app" });
    })();
  };

  return (
    <AuthShell
      title="Create an account"
      subtitle="inteligir is invite-only while it's early."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/app/sign-in" className="underline underline-offset-4">
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
          minLength={8}
          required
          hint="At least 8 characters."
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
        <Button type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
