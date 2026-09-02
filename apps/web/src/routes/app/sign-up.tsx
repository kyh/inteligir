import { useState } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { Button } from "@repo/ui/components/button";

import { AuthError, AuthField, AuthShell, fieldValue } from "@/components/auth-shell";
import { currentSession, ssrWhenSignedOut } from "@/lib/session-guard";

// not the Better Auth client: sign-up is invite-gated by a Worker route
// (src/worker/auth/invite.ts) that forwards Better Auth's response, cookie included
const SIGN_UP_URL = "/v1/auth/sign-up";

const FALLBACK_ERROR = "Something went wrong — try again.";

const refusalSchema = z.looseObject({ message: z.string().min(1) });

async function refusalMessage(response: Response): Promise<string> {
  const body = refusalSchema.safeParse(await response.json().catch(() => null));
  return body.success ? body.data.message : FALLBACK_ERROR;
}

export const Route = createFileRoute("/app/sign-up")({
  ssr: ssrWhenSignedOut,
  beforeLoad: async () => {
    if ((await currentSession()) !== null) throw redirect({ to: "/" });
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
      await router.navigate({ to: "/" });
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
