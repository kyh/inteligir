import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";

import { Button } from "@repo/ui/components/button";

import { AuthError, AuthField, AuthShell, fieldValue, useAuthSubmit } from "#components/auth-shell";
import { authClient, authErrorMessage } from "#lib/auth-client";
import { authPageSearchSchema, signedInLanding } from "#lib/next-path";
import { currentSession, ssrWhenSignedOut } from "#lib/session-guard";
import { siteConfig } from "#lib/site-config";

const SignInPage = () => {
  const router = useRouter();
  const { next } = Route.useSearch();
  const { error, onSubmit, pending } = useAuthSubmit(async (form) => {
    const { error: failure } = await authClient.signIn.email({
      email: fieldValue(form, "email"),
      password: fieldValue(form, "password"),
    });
    if (failure !== null) {
      return authErrorMessage(failure);
    }
    await router.navigate({ href: signedInLanding(next), reloadDocument: true });
    return null;
  });

  return (
    <AuthShell
      title="Sign in"
      subtitle={siteConfig.description}
      footer={
        <>
          No account?{" "}
          <Link to="/app/sign-up" search={{ next }} className="underline underline-offset-4">
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
        <Button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
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
};

export const Route = createFileRoute("/app/sign-in")({
  ssr: ssrWhenSignedOut,
  validateSearch: authPageSearchSchema,
  beforeLoad: async ({ search }) => {
    const session = await currentSession();
    if (session.kind === "signed-in") {
      redirect({ href: signedInLanding(search.next), reloadDocument: true, throw: true });
    }
  },
  component: SignInPage,
});
