import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@repo/contract/cloud/device/device-schema";
import { Button } from "@repo/ui/components/button";

import {
  AuthError,
  AuthField,
  AuthShell,
  fieldValue,
  useAuthSubmit,
} from "@/components/auth-shell";
import { authClient, authErrorMessage } from "@/lib/auth-client";

// Better Auth's GET leg lands a live link here with ?token= and a spent or expired one with
// ?error=. Each field catches on its own: a key the schema leaves out keeps its raw value in the
// route's search, so a malformed one must come back as undefined to read as a dead link.
const resetSearchSchema = z.object({
  // oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
  error: z.catch(z.string().optional(), undefined),
  // oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
  token: z.catch(z.string().min(1).optional(), undefined),
});

type SettledView = { readonly kind: "done" } | { readonly kind: "dead" };

type ResetView = { readonly kind: "form"; readonly token: string } | SettledView;

const linkView = ({ error, token }: z.infer<typeof resetSearchSchema>): ResetView =>
  token === undefined || error !== undefined ? { kind: "dead" } : { kind: "form", token };

const SignInLink = ({ label }: { label: string }) => (
  <Link to="/app/sign-in" className="underline underline-offset-4">
    {label}
  </Link>
);

const ResetForm = ({
  token,
  onSettled,
}: {
  token: string;
  onSettled: (view: SettledView) => void;
}) => {
  const { error, onSubmit, pending } = useAuthSubmit(async (form) => {
    const newPassword = fieldValue(form, "password");
    if (newPassword !== fieldValue(form, "confirm")) {
      return "Passwords don't match.";
    }
    const { error: failure } = await authClient.resetPassword({ newPassword, token });
    if (failure === null) {
      onSettled({ kind: "done" });
      return null;
    }
    // the token is single-use, so a refused one stays refused and a retry could only fail again
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
      footer={<SignInLink label="Back to sign in" />}
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
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </AuthShell>
  );
};

const PasswordChanged = () => (
  <AuthShell
    title="Password changed"
    subtitle="Sign in with your new password from now on."
    footer={<SignInLink label="Sign in" />}
  >
    <p className="text-center text-sm text-muted-foreground">
      Macs and phones already signed in stay signed in. You can close this tab.
    </p>
  </AuthShell>
);

const DeadLink = () => (
  <AuthShell
    title="This link is invalid or has expired"
    subtitle="A reset link works once, and only for a while."
    footer={<SignInLink label="Back to sign in" />}
  >
    <p className="text-center text-sm">
      <Link to="/app/forgot-password" className="underline underline-offset-4">
        Send a new link
      </Link>
    </p>
  </AuthShell>
);

const ResetPasswordPage = () => {
  const search = Route.useSearch();
  const [view, setView] = useState(() => linkView(search));

  switch (view.kind) {
    case "form": {
      return <ResetForm token={view.token} onSettled={setView} />;
    }
    case "done": {
      return <PasswordChanged />;
    }
    case "dead": {
      return <DeadLink />;
    }
    default: {
      const exhaustive: never = view;
      return exhaustive;
    }
  }
};

// The URL carries a live single-use token: client-only so no server render works from it,
// no-store so no cache keeps it, and no-referrer so no request the page makes repeats it.
export const Route = createFileRoute("/app/reset-password")({
  ssr: false,
  validateSearch: resetSearchSchema,
  headers: () => ({ "Cache-Control": "no-store" }),
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
  component: ResetPasswordPage,
});
