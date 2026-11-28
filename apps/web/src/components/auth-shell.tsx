import { useState } from "react";
import Link from "next/link";

import { Input } from "@repo/ui/components/input";

import { siteConfig } from "#lib/site-config";
import { useHydrated } from "#lib/use-hydrated";

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
    <Input id={id} {...input} />
    {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

export const fieldValue = (form: FormData, name: string) => {
  const value = form.get(name);

  return value === null || value instanceof File ? "" : value;
};

export const CONNECTION_FAILED = `Couldn't reach ${siteConfig.name} — check your connection.`;

type AuthSubmit = (form: FormData) => Promise<string | null>;

type SubmitState =
  | { readonly kind: "idle" | "pending" | "done" }
  | { readonly kind: "refused"; readonly message: string };

export const settleAuthSubmit = async (submit: AuthSubmit, form: FormData) => {
  try {
    const message = await submit(form);

    return (
      message === null ? { kind: "done" } : { kind: "refused", message }
    ) satisfies SubmitState;
  } catch {
    return { kind: "refused", message: CONNECTION_FAILED } satisfies SubmitState;
  }
};

export const submitView = (state: SubmitState) => ({
  busy: state.kind === "pending" || state.kind === "done",
  done: state.kind === "done",
  error: state.kind === "refused" ? state.message : null,
});

export const useAuthSubmit = (submit: AuthSubmit) => {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const hydrated = useHydrated();

  const settle = async (form: FormData) => {
    setState({ kind: "pending" });
    setState(await settleAuthSubmit(submit, form));
  };

  const onSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
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

export const leaveForm = (href: string) => {
  window.location.replace(href);
};
