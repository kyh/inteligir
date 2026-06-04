import { createFileRoute, Link } from "@tanstack/react-router";

import { AuthForm } from "@/components/auth-form";

export const Route = createFileRoute("/auth/register")({
  component: RegisterPage,
});

function RegisterPage() {
  return (
    <>
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create an account
        </h1>
        <p className="text-muted-foreground text-sm">
          Enter your details to get started
        </p>
      </div>
      <AuthForm type="register" />
      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{" "}
        <Link to="/auth/login" className="text-primary underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </>
  );
}
