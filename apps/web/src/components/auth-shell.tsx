import { useState, useTransition } from "react";
import { Link, useHydrated } from "@tanstack/react-router";

import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { siteConfig } from "#lib/site-config";

// top-anchored, not centred: an error line or an outcome arriving after a round trip would move a
// centred card's title and fields by half its height; svh, since dvh moves with a phone's address bar
export const AuthShell = ({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) => (
  <main className="flex min-h-dvh w-full items-start justify-center px-6 pt-[18svh] pb-16">
    <div className="w-full max-w-sm">
      <Link to="/" className="mb-8 block text-center text-sm font-medium tracking-tight">
        {siteConfig.name}
      </Link>
      <h1 className="text-center text-lg font-medium tracking-tight">{title}</h1>
      <p className="mt-1 mb-6 text-center text-sm text-muted-foreground">{subtitle}</p>
      {children}
      <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
    </div>
  </main>
);

export const AuthField = ({
  id,
  label,
  hint,
  ...input
}: { id: string; label: string; hint?: string } & React.ComponentProps<"input">) => (
  <div className="grid gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} className="h-9" {...input} />
    {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

// FormData.get answers File | string; a non-text value reads as empty rather than "[object File]".
export const fieldValue = (form: FormData, name: string): string => {
  const value = form.get(name);
  return value === null || value instanceof File ? "" : value;
};

export const CONNECTION_FAILED = "Couldn't reach inteligir — check your connection.";

// a submit answers the message to show, or null once it has gone where it was going
type AuthSubmit = (form: FormData) => Promise<string | null>;

// a throw is a request that never reached the Worker; escaping the transition, it would land on
// the route's error boundary and take the typed form with it
export const settleAuthSubmit = async (
  submit: AuthSubmit,
  form: FormData,
): Promise<string | null> => {
  try {
    return await submit(form);
  } catch {
    return CONNECTION_FAILED;
  }
};

// onSubmit, not <form action>: an action resets an uncontrolled form, and a refused submit
// must keep what was typed
export const useAuthSubmit = (submit: AuthSubmit) => {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // a submit before hydration is the browser's own: a GET that reloads the page with the password
  // in its address
  const hydrated = useHydrated();

  const onSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const message = await settleAuthSubmit(submit, form);
      startTransition(() => {
        setError(message);
      });
    });
  };

  return { error, onSubmit, pending, ready: hydrated };
};

export const AuthError = ({ message }: { message: string | null }) => {
  if (message === null) {
    return null;
  }
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
};
