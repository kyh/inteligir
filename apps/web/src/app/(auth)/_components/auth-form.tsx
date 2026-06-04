"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Type } from "@sinclair/typebox";
import { Button } from "@repo/ui/components/button";
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import { useForm } from "@tanstack/react-form";

import { authClient } from "@/lib/auth-client";
import { tb } from "@/lib/form-schema";

const EmailField = Type.String({ format: "email", minLength: 1 });
const PasswordField = Type.String({ minLength: 1 });
const PasswordMin8 = Type.String({ minLength: 8 });

const LoginSchema = tb(Type.Object({ email: EmailField, password: PasswordField }));
const EmailOnlySchema = tb(Type.Object({ email: EmailField }));

type AuthFormProps = {
  type: "login" | "register";
} & React.HTMLAttributes<HTMLDivElement>;

/** Same-origin path only — prevents open-redirect via crafted ?nextPath= values. */
const safeNext = (raw: string | null): string => {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
};

export const AuthForm = ({ className, type, ...props }: AuthFormProps) => {
  const router = useRouter();
  const nextPath = safeNext(useSearchParams().get("nextPath"));
  const [submittingGithub, setSubmittingGithub] = useState(false);

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    validators: {
      onSubmit: LoginSchema,
    },
    onSubmit: async ({ value }) => {
      if (type === "register") {
        const emailPrefix = value.email.split("@")[0];
        await authClient.signUp.email({
          email: value.email,
          password: value.password,
          name: emailPrefix ?? "User",
          fetchOptions: {
            onSuccess: () => {
              router.replace(nextPath);
            },
            onError: (ctx) => {
              toast.error(ctx.error.message);
            },
          },
        });
      }

      if (type === "login") {
        await authClient.signIn.email({
          email: value.email,
          password: value.password,
          fetchOptions: {
            onSuccess: () => {
              router.replace(nextPath);
            },
            onError: (ctx) => {
              toast.error(ctx.error.message);
            },
          },
        });
      }
    },
  });

  const handleAuthWithGithub = async () => {
    setSubmittingGithub(true);
    await authClient.signIn.social({
      provider: "github",
      fetchOptions: {
        onSuccess: () => {
          router.replace(nextPath);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
        onResponse: () => {
          setSubmittingGithub(false);
        },
      },
    });
  };

  return (
    <div className={cn("grid gap-6", className)} {...props}>
      <Button
        variant="outline"
        type="button"
        loading={submittingGithub}
        onClick={handleAuthWithGithub}
      >
        Continue with Github
      </Button>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background text-muted-foreground px-2">Or</span>
        </div>
      </div>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup className="gap-2">
          <form.Field
            name="email"
            validators={{
              onBlur: tb(EmailField),
            }}
          >
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

              return (
                <Field data-invalid={isInvalid} className="gap-1">
                  <FieldLabel className="sr-only" htmlFor="email">
                    Email
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id="email"
                      data-test="email-input"
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={isInvalid}
                      required
                      type="email"
                      placeholder="name@example.com"
                      autoCapitalize="none"
                      autoComplete="email"
                      autoCorrect="off"
                    />
                  </FieldContent>
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <form.Field
            name="password"
            validators={{
              onBlur: tb(PasswordField),
            }}
          >
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

              return (
                <Field data-invalid={isInvalid} className="gap-1">
                  <FieldLabel className="sr-only" htmlFor="password">
                    Password
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id="password"
                      data-test="password-input"
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={isInvalid}
                      required
                      type="password"
                      placeholder="******"
                      autoCapitalize="none"
                      autoComplete="current-password"
                      autoCorrect="off"
                    />
                  </FieldContent>
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
        </FieldGroup>
        <Button type="submit" loading={form.state.isSubmitting}>
          {type === "login" ? "Login" : "Register"}
        </Button>
      </form>
    </div>
  );
};

export const RequestPasswordResetForm = () => {
  const form = useForm({
    defaultValues: {
      email: "",
    },
    validators: {
      onSubmit: EmailOnlySchema,
    },
    onSubmit: async ({ value }) => {
      await authClient.requestPasswordReset({
        email: value.email,
        fetchOptions: {
          onSuccess: () => {
            toast.success("Password reset email sent successfully!");
          },
          onError: (ctx) => {
            toast.error(ctx.error.message);
          },
        },
      });
    },
  });

  if (form.state.isSubmitSuccessful) {
    return (
      <div className="space-y-4 text-center">
        <div className="rounded-md bg-green-50 p-4">
          <p className="text-sm text-green-800">
            Password reset email sent! Check your inbox and follow the instructions to reset your
            password.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup className="gap-4">
        <form.Field
          name="email"
          validators={{
            onBlur: tb(EmailField),
          }}
        >
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

            return (
              <Field data-invalid={isInvalid} className="gap-1">
                <FieldLabel className="sr-only" htmlFor="reset-email">
                  Email
                </FieldLabel>
                <FieldContent>
                  <Input
                    id="reset-email"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={isInvalid}
                    required
                    type="email"
                    placeholder="name@example.com"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect="off"
                  />
                </FieldContent>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>
      <Button type="submit" loading={form.state.isSubmitting}>
        Request Password Reset
      </Button>
    </form>
  );
};

export const UpdatePasswordForm = () => {
  const router = useRouter();

  const form = useForm({
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
    validators: {
      // Cross-field "passwords match" check runs inside the form-level
      // onSubmit instead of inside the schema (TypeBox doesn't have a
      // built-in "refine"). The password-length check stays at the field
      // level so the user gets immediate per-field feedback.
      onSubmit: ({ value }) =>
        value.password === value.confirmPassword
          ? undefined
          : { fields: { confirmPassword: "Passwords don't match" } },
    },
    onSubmit: async ({ value }) => {
      await authClient.resetPassword({
        newPassword: value.password,
        fetchOptions: {
          onSuccess: () => {
            toast.success("Password updated successfully!");
            router.push("/");
          },
          onError: (ctx) => {
            toast.error(ctx.error.message);
          },
        },
      });
    },
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup className="gap-4">
        <form.Field
          name="password"
          validators={{
            onBlur: tb(PasswordMin8),
          }}
        >
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

            return (
              <Field data-invalid={isInvalid} className="gap-1">
                <FieldLabel className="sr-only" htmlFor="new-password">
                  New Password
                </FieldLabel>
                <FieldContent>
                  <Input
                    id="new-password"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={isInvalid}
                    required
                    type="password"
                    placeholder="Enter new password"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    autoCorrect="off"
                  />
                </FieldContent>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
        <form.Field
          name="confirmPassword"
          validators={{
            onChange: ({ value, fieldApi }) => {
              if (!value) {
                return "Confirm your new password";
              }

              const password = fieldApi.form.getFieldValue("password");
              if (password !== value) {
                return "Passwords don't match";
              }
            },
          }}
        >
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

            return (
              <Field data-invalid={isInvalid} className="gap-1">
                <FieldLabel className="sr-only" htmlFor="confirm-password">
                  Confirm New Password
                </FieldLabel>
                <FieldContent>
                  <Input
                    id="confirm-password"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={isInvalid}
                    required
                    type="password"
                    placeholder="Confirm new password"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    autoCorrect="off"
                  />
                </FieldContent>
                {isInvalid && (
                  <FieldError
                    errors={field.state.meta.errors.map((error) =>
                      typeof error === "string" ? { message: error } : error,
                    )}
                  />
                )}
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>
      <Button type="submit" loading={form.state.isSubmitting}>
        Update Password
      </Button>
    </form>
  );
};
