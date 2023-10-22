"use client";

import { useForm } from "react-hook-form";
import Link from "next/link";
import Trans from "@inteligir/ui/trans";
import TextField from "@inteligir/ui/text-field";
import Button from "@inteligir/ui/button";
import { If } from "@/components/if";

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
            <Trans i18nKey="common:emailAddress" />

            <TextField.Input
              data-cy="email-input"
              placeholder="your@email.com"
              required
              type="email"
              {...emailControl}
            />
          </TextField.Label>
        </TextField>

        <TextField>
          <TextField.Label>
            <Trans i18nKey="common:password" />

            <TextField.Input
              data-cy="password-input"
              placeholder=""
              required
              type="password"
              {...passwordControl}
            />

            <div className="py-0.5 text-xs">
              <Link className="hover:underline" href="/auth/password-reset">
                <Trans i18nKey="auth:passwordForgottenQuestion" />
              </Link>
            </div>
          </TextField.Label>
        </TextField>

        <div>
          <Button
            className="w-full"
            data-cy="auth-submit-button"
            loading={loading}
            type="submit"
          >
            <If condition={loading} fallback={<Trans i18nKey="auth:signIn" />}>
              <Trans i18nKey="auth:signingIn" />
            </If>
          </Button>
        </div>
      </div>
    </form>
  );
};

export default EmailPasswordSignInForm;
