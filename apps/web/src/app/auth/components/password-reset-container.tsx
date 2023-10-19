"use client";

import type { FormEvent } from "react";
import { useCallback } from "react";
import If from "ui/components/If";
import Alert from "ui/components/Alert";
import TextField from "ui/components/TextField";
import Button from "ui/components/Button";
import Trans from "ui/components/Trans";
import useResetPassword from "@/features/auth/use-reset-password";
import AuthErrorMessage from "@/app/auth/components/AuthErrorMessage";
import configuration from "@/configuration";

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
          <Trans i18nKey="auth:passwordResetSuccessMessage" />
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
                  <Trans i18nKey="auth:passwordResetSubheading" />
                </p>
              </div>

              <div>
                <TextField.Label>
                  <Trans i18nKey="common:emailAddress" />

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
                <Trans i18nKey="auth:passwordResetLabel" />
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
