"use client";

import type { FormEvent } from "react";
import { useCallback } from "react";
import Alert from "@inteligir/ui/alert";
import TextField from "@inteligir/ui/text-field";
import Button from "@inteligir/ui/button";
import Trans from "@inteligir/ui/trans";
import { If } from "@/components/if";
import useResetPassword from "@/features/auth/use-reset-password";
import AuthErrorMessage from "@/app/auth/components/auth-error-message";
import { configuration } from "@/lib/configuration";

const PasswordResetContainer = () => {
  const resetPasswordMutation = useResetPassword();
  const error = resetPasswordMutation.error;
  const success = resetPasswordMutation.data;

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const data = new FormData(event.currentTarget);
      const email = data.get("email") as string;
      const redirectTo = getReturnUrl();

      await resetPasswordMutation.trigger({
        email,
        redirectTo,
      });
    },
    [resetPasswordMutation],
  );

  return (
    <>
      <If condition={success}>
        <Alert type="success">
          Check your Inbox! We emailed you a link for resetting your Password.
        </Alert>
      </If>
      <If condition={!resetPasswordMutation.data}>
        <>
          <form
            className="container mx-auto flex justify-center"
            onSubmit={(e) => void onSubmit(e)}
          >
            <div className="flex-col space-y-4">
              <div>
                <p className="text-sm text-gray-700 dark:text-gray-400">
                  Enter your email address below. You will receive a link to
                  reset your password.
                </p>
              </div>

              <div>
                <TextField.Label>
                  Email Address
                  <TextField.Input
                    name="email"
                    placeholder="your@email.com"
                    required
                    type="email"
                  />
                </TextField.Label>
              </div>

              <AuthErrorMessage error={error} />

              <Button
                block
                loading={resetPasswordMutation.isMutating}
                type="submit"
              >
                Reset Password
              </Button>
            </div>
          </form>
        </>
      </If>
    </>
  );
};

export default PasswordResetContainer;

/**
 * @description
 * Return the URL where the user will be redirected to after resetting
 * their password
 */
const getReturnUrl = () => {
  const host = window.location.origin;
  const callback = configuration.paths.authCallback;

  return `${host}${callback}`;
};
