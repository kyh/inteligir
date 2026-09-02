import { useState } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { Button } from "@repo/ui/components/button";

import { AuthError, AuthField, AuthShell, fieldValue } from "@/components/auth-shell";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { internalNextPath } from "@/lib/next-path";
import { currentSession, ssrWhenSignedOut } from "@/lib/session-guard";

interface SignInSearch {
  next?: string;
}

const signInSearchSchema = z.looseObject({ next: z.string().min(1) });

export const Route = createFileRoute("/app/sign-in")({
  ssr: ssrWhenSignedOut,
  validateSearch: (search): SignInSearch => {
    const parsed = signInSearchSchema.safeParse(search);
    return parsed.success ? { next: parsed.data.next } : {};
  },
  beforeLoad: async ({ search }) => {
    if ((await currentSession()) !== null) {
      throw redirect({ href: internalNextPath(search.next) ?? "/" });
    }
  },
  component: SignInPage,
});

function SignInPage() {
  const router = useRouter();
  const { next } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    void (async () => {
      const { error: failure } = await authClient.signIn.email({
        email: fieldValue(form, "email"),
        password: fieldValue(form, "password"),
      });
      if (failure !== null) {
        setError(authErrorMessage(failure));
        setBusy(false);
        return;
      }
      await router.navigate({ href: internalNextPath(next) ?? "/" });
    })();
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Your notes, and an agent that edits them."
      footer={
        <>
          No account?{" "}
          <Link to="/app/sign-up" className="underline underline-offset-4">
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
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <Link
          to="/app/forgot-password"
          className="text-center text-xs text-muted-foreground underline underline-offset-4"
        >
          Forgot your password?
        </Link>
      </form>
    </AuthShell>
  );
}
