import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import {
  AUTH_API_PATHS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@repo/contract/account/account-schema";
import type { SignUpRequest } from "@repo/contract/account/account-schema";
import { Button } from "@repo/ui/components/button";

import { AuthError, AuthField, AuthShell, fieldValue, useAuthSubmit } from "#components/auth-shell";
import { AUTH_FALLBACK_ERROR } from "#lib/auth-client";
import { authPageSearchSchema, signedInLanding } from "#lib/next-path";
import { currentSession, ssrWhenSignedOut } from "#lib/session-guard";

const refusalSchema = z.looseObject({ message: z.string().min(1) });

const refusalMessage = async (response: Response): Promise<string> => {
  const body = refusalSchema.safeParse(await response.json().catch(() => null));
  return body.success ? body.data.message : AUTH_FALLBACK_ERROR;
};

const SignUpPage = () => {
  const router = useRouter();
  const { next } = Route.useSearch();
  const { error, onSubmit, pending, ready } = useAuthSubmit(async (form) => {
    const request: SignUpRequest = {
      email: fieldValue(form, "email"),
      inviteCode: fieldValue(form, "inviteCode"),
      name: fieldValue(form, "name"),
      password: fieldValue(form, "password"),
    };
    // not the Better Auth client: the invite gate forwards Better Auth's response, cookie included
    const response = await fetch(AUTH_API_PATHS.signUp, {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      return await refusalMessage(response);
    }
    await router.navigate({ href: signedInLanding(next), reloadDocument: true });
    return null;
  });

  return (
    <AuthShell
      title="Create an account"
      subtitle="inteligir is invite-only while it's early."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/app/sign-in" search={{ next }} className="underline underline-offset-4">
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
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
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
        <Button type="submit" disabled={pending || !ready}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
};

export const Route = createFileRoute("/_site/app/sign-up")({
  ssr: ssrWhenSignedOut,
  validateSearch: authPageSearchSchema,
  beforeLoad: async ({ search }) => {
    const session = await currentSession();
    if (session.kind === "signed-in") {
      redirect({ href: signedInLanding(search.next), reloadDocument: true, throw: true });
    }
  },
  component: SignUpPage,
});
