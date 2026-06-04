import { createFileRoute, Link } from "@tanstack/react-router";

import { AuthForm } from "@/components/auth-form";

export const Route = createFileRoute("/auth/login")({
  component: LoginPage,
});

function LoginPage() {
  return (
    <>
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground text-sm">
          Sign in to your account
        </p>
      </div>
      <AuthForm type="login" />
      <p className="text-muted-foreground text-center text-sm">
        Don&apos;t have an account?{" "}
        <Link to="/auth/register" className="text-primary underline underline-offset-4">
          Register
        </Link>
      </p>
    </>
  );
}
