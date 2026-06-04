import { useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { Type } from "@sinclair/typebox";
import { toast } from "sonner";

import { Button } from "@repo/ui/components/button";
import { Field, FieldError } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";

import { authClient } from "@/auth/client";
import { tb } from "@/lib/form-schema";

const EmailSchema = Type.String({
  format: "email",
  minLength: 1,
  errorMessage: "Please enter a valid email",
});

const PasswordSchema = Type.String({
  minLength: 8,
  errorMessage: "Password must be at least 8 characters",
});

export function AuthForm({ type }: { type: "login" | "register" }) {
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
      ...(type === "register" ? { name: "" } : {}),
    },
    onSubmit: async ({ value }) => {
      try {
        if (type === "register") {
          const { error } = await authClient.signUp.email({
            email: value.email,
            password: value.password,
            name: (value as { name?: string }).name || value.email.split("@")[0]!,
          });
          if (error) {
            toast.error(error.message ?? "Registration failed");
            return;
          }
          toast.success("Account created!");
        } else {
          const { error } = await authClient.signIn.email({
            email: value.email,
            password: value.password,
          });
          if (error) {
            toast.error(error.message ?? "Login failed");
            return;
          }
        }
        void navigate({ to: "/" });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="space-y-4"
    >
      {type === "register" && (
        <form.Field name="name">
          {(field) => (
            <Field>
              <Input
                placeholder="Name"
                value={field.state.value as string}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </Field>
          )}
        </form.Field>
      )}
      <form.Field
        name="email"
        validators={{ onBlur: tb(EmailSchema) }}
      >
        {(field) => (
          <Field>
            <Input
              type="email"
              placeholder="Email"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.meta.errors.length > 0 && (
              <FieldError>{field.state.meta.errors[0]?.message}</FieldError>
            )}
          </Field>
        )}
      </form.Field>
      <form.Field
        name="password"
        validators={{ onBlur: tb(PasswordSchema) }}
      >
        {(field) => (
          <Field>
            <Input
              type="password"
              placeholder="Password"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.meta.errors.length > 0 && (
              <FieldError>{field.state.meta.errors[0]?.message}</FieldError>
            )}
          </Field>
        )}
      </form.Field>
      <Button type="submit" className="w-full">
        {type === "register" ? "Create account" : "Sign in"}
      </Button>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="border-border w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background text-muted-foreground px-2">Or</span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => void authClient.signIn.social({ provider: "github" })}
      >
        Continue with GitHub
      </Button>
    </form>
  );
}
