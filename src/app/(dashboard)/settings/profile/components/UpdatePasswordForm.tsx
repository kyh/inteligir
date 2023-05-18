"use client";

import { useCallback, useEffect } from "react";
import type { User } from "@supabase/gotrue-js";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import useUpdateUserMutation from "~/core/hooks/use-update-user-mutation";
import Alert from "~/components/Alert";
import Button from "~/components/Button";
import If from "~/components/If";
import { TextField } from "~/components/TextField";

const UpdatePasswordForm: React.FCC<{ user: User }> = ({ user }) => {
  const updateUserMutation = useUpdateUserMutation();

  const { register, handleSubmit, reset, getValues, formState } = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      repeatPassword: "",
    },
  });

  const errors = formState.errors;

  const newPasswordControl = register("newPassword", {
    value: "",
    required: true,
    minLength: {
      value: 6,
      message: "Password must be at least 6 characters long",
    },
    validate: (value) => {
      if (value === getValues("currentPassword")) {
        return "New password cannot be the same as the current one";
      }
    },
  });

  const repeatPasswordControl = register("repeatPassword", {
    value: "",
    required: true,
    minLength: {
      value: 6,
      message: "Password must be at least 6 characters long",
    },
    validate: (value) => {
      if (value !== getValues("newPassword")) {
        return "Passwords do not match";
      }
    },
  });

  const updatePasswordFromCredential = useCallback(
    async (password: string) => {
      const promise = updateUserMutation.trigger({ password });

      return await toast.promise(promise, {
        success: "Password updated successfully",
        error: "An error occurred",
        loading: "Updating password...",
      });
    },
    [updateUserMutation]
  );

  const updatePasswordCallback = useCallback(
    async (user: User, currentPassword: string, newPassword: string) => {
      const email = user.email;

      // if the user does not have an email assigned, it's possible they
      // don't have an email/password factor linked, and the UI is out of sync
      if (!email) {
        return Promise.reject("User does not have an email assigned");
      }

      try {
        return await updatePasswordFromCredential(newPassword);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [updatePasswordFromCredential]
  );

  const onSubmit = useCallback(
    async (params: { currentPassword: string; newPassword: string }) => {
      const { newPassword, currentPassword } = params;

      return updatePasswordCallback(user, currentPassword, newPassword);
    },
    [user, updatePasswordCallback]
  );

  // reset form on success
  useEffect(() => {
    if (updateUserMutation.data) {
      reset();
    }
  }, [reset, updateUserMutation]);

  const { isMutating, data } = updateUserMutation;

  return (
    <form data-cy="update-password-form" onSubmit={handleSubmit(onSubmit)}>
      <div className="flex flex-col space-y-4">
        <If condition={data}>
          <Alert type="success">
            <Alert.Heading>Password update request successful</Alert.Heading>
            We sent you an email to confirm your new password. Please check your
            inbox and click on the link to confirm your new password.
          </Alert>
        </If>

        <TextField>
          <TextField.Label>
            New Password
            <TextField.Input
              data-cy="new-password"
              required
              type="password"
              {...newPasswordControl}
            />
            <TextField.Error
              data-cy="new-password-error"
              error={errors.newPassword?.message}
            />
          </TextField.Label>
        </TextField>

        <TextField>
          <TextField.Label>
            Repeat New Password
            <TextField.Input
              data-cy="repeat-new-password"
              required
              type="password"
              {...repeatPasswordControl}
            />
            <TextField.Error
              data-cy="repeat-password-error"
              error={errors.repeatPassword?.message}
            />
          </TextField.Label>
        </TextField>

        <div>
          <Button className="w-full md:w-auto" loading={isMutating}>
            Update Password
          </Button>
        </div>
      </div>
    </form>
  );
};

export default UpdatePasswordForm;
