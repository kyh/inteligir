import { useState } from "react";
import Link from "next/link";

import { Input } from "@repo/ui/components/input";

import { siteConfig } from "#lib/site-config";
import { useHydrated } from "#lib/use-hydrated";

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
      <Link href="/" className="mb-8 block text-center text-sm font-medium tracking-tight">
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
    <label htmlFor={id} className="text-subtitle leading-none font-medium select-none">
      {label}
    </label>
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

// Where a form's submit stands. `done` is never `idle` again: a sign-in that went through is
// still loading the next document, and a form live meanwhile posts what the first press did.
type SubmitState =
  | { readonly kind: "idle" | "pending" | "done" }
  | { readonly kind: "refused"; readonly message: string };

// a throw is a request that never reached the app; unsettled, it would leave the form pending and
// its button dead
export const settleAuthSubmit = async (
  submit: AuthSubmit,
  form: FormData,
): Promise<SubmitState> => {
  try {
    const message = await submit(form);
    return message === null ? { kind: "done" } : { kind: "refused", message };
  } catch {
    return { kind: "refused", message: CONNECTION_FAILED };
  }
};

// what a form draws of its submit: `busy` holds the button and its label
export const submitView = (state: SubmitState) => ({
  busy: state.kind === "pending" || state.kind === "done",
  done: state.kind === "done",
  error: state.kind === "refused" ? state.message : null,
});

// onSubmit, not <form action>: an action resets an uncontrolled form, and a refused submit
// must keep what was typed
export const useAuthSubmit = (submit: AuthSubmit) => {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  // a submit before hydration is the browser's own: a GET that reloads the page with the password
  // in its address
  const hydrated = useHydrated();

  const settle = async (form: FormData): Promise<void> => {
    setState({ kind: "pending" });
    setState(await settleAuthSubmit(submit, form));
  };
  const onSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    // with the button pressed, as the browser's own submit sends it
    void settle(new FormData(event.currentTarget, event.nativeEvent.submitter));
  };

  return { ...submitView(state), onSubmit, ready: hydrated };
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

// in place of the form, which Back must not return to with its submit done, and by a document
// load, since the library opens on a document of its own
export const leaveForm = (href: string): void => {
  window.location.replace(href);
};
