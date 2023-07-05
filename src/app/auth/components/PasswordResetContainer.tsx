"use client";

import { FormEvent, useCallback } from "react";
import useResetPassword from "~/core/hooks/use-reset-password";
import { Alert } from "~/components/Alert";
import { Button } from "~/components/Button";
import If from "~/components/If";
import { TextField } from "~/components/TextField";

function PasswordResetContainer() {
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
    [resetPasswordMutation]
  );

  return (
    <>
      <If condition={success}>
        <Alert type="success">
          Check your Inbox! We emailed you a link for resetting your Password.
        </Alert>
      </If>
      <If condition={!resetPasswordMutation.data}>
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="container mx-auto flex justify-center"
        >
          <div className="flex-col space-y-4">
            <div>
              <p className="text-sm text-zinc-700 dark:text-zinc-400">
                Enter your email address below. You will receive a link to reset
                your password.
              </p>
            </div>
            <div>
              <TextField.Label>
                Email Address
                <TextField.Input
                  name="email"
                  required
                  type="email"
                  placeholder="your@email.com"
                />
              </TextField.Label>
            </div>
            <Button
              loading={resetPasswordMutation.isMutating}
              type="submit"
              className="w-full"
            >
              Reset Password
            </Button>
          </div>
        </form>
      </If>
    </>
  );
}

export default PasswordResetContainer;

function getReturnUrl() {
  const host = window.location.origin;
  const callback = "/auth/callback";
  const redirectPath = "/settings/profile/password";

  return `${host}${callback}?redirectPath=${redirectPath}`;
}
