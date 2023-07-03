"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { Button } from "~/components/Button";
import { TextField } from "~/components/TextField";

const EmailPasswordSignInForm: React.FCC<{
  onSubmit: (params: { email: string; password: string }) => unknown;
  loading: boolean;
}> = ({ onSubmit, loading }) => {
  const { register, handleSubmit } = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const emailControl = register("email", { required: true });
  const passwordControl = register("password", { required: true });

  return (
    <form className="w-full" onSubmit={handleSubmit(onSubmit)}>
      <div className="flex-col space-y-4">
        <TextField>
          <TextField.Label>
            Email Address
            <TextField.Input
              data-cy="email-input"
              required
              type="email"
              placeholder="your@email.com"
              {...emailControl}
            />
          </TextField.Label>
        </TextField>
        <TextField>
          <TextField.Label>
            Password
            <TextField.Input
              required
              data-cy="password-input"
              type="password"
              placeholder=""
              {...passwordControl}
            />
            <TextField.Hint
              as={Link}
              href="/auth/password-reset"
              className="hover:underline"
            >
              Forgot your password?
            </TextField.Hint>
          </TextField.Label>
        </TextField>
        <div>
          <Button
            className="w-full"
            data-cy="auth-submit-button"
            type="submit"
            loading={loading}
          >
            Sign In
          </Button>
        </div>
      </div>
    </form>
  );
};

export default EmailPasswordSignInForm;
