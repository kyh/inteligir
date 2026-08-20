import { Link } from "@tanstack/react-router";

import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { siteConfig } from "@/lib/site-config";

// The chrome every auth page shares. Three pages, one card, one field shape —
// so a change to focus, spacing or error placement lands on all of them.

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center px-6 py-16">
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
}

export function AuthField({
  id,
  label,
  hint,
  ...input
}: { id: string; label: string; hint?: string } & React.ComponentProps<"input">) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-9" {...input} />
      {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * One `AuthField`'s submitted value.
 *
 * `FormData.get` answers `File | string`, because a form MAY carry a file
 * input — none of these do. Narrowing rather than stringifying means a value
 * that somehow is not text reads as empty and is refused by the same
 * required-field path as a blank box, instead of reaching the server as
 * `"[object File]"`.
 */
export function fieldValue(form: FormData, name: string): string {
  const value = form.get(name);
  return value === null || value instanceof File ? "" : value;
}

/** The one place a form failure is rendered. `role="alert"` because the
 * message appears after a submit the user has already stopped reading for. */
export function AuthError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
