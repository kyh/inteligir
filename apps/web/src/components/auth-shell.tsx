import { Link } from "@tanstack/react-router";

import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { siteConfig } from "@/lib/site-config";

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
