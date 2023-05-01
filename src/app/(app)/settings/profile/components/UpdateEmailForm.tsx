"use client";

import { useCallback, useEffect } from "react";
import toast from "react-hot-toast";
import { useForm } from "react-hook-form";
import type { User } from "@supabase/gotrue-js";

import Button from "~/core/ui/Button";
import TextField from "~/core/ui/TextField";
import useUpdateUserMutation from "~/core/hooks/use-update-user-mutation";
import If from "~/core/ui/If";
import Alert from "~/core/ui/Alert";

const UpdateEmailForm: React.FC<{ user: User }> = ({ user }) => {
  const updateUserMutation = useUpdateUserMutation();

  const updateEmail = useCallback(
    (email: string) => {
      const promise = updateUserMutation.trigger({ email });

      return toast.promise(promise, {
        success: "Email updated successfully",
        loading: "Updating email address...",
        error: (error: Error) => error.message ?? "An error occurred",
      });
    },
    [updateUserMutation]
  );

  const currentEmail = user?.email as string;

  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      email: "",
      repeatEmail: "",
    },
  });

  const onSubmit = useCallback(
    async (params: { email: string; repeatEmail: string }) => {
      const { email, repeatEmail } = params;

      if (email !== repeatEmail) {
        const message = "Emails do not match";
        return toast.error(message);
      }

      if (email === currentEmail) {
        const message = "Email is the same as the current one";
        return toast.error(message);
      }

      return await updateEmail(email);
    },
    [currentEmail, updateEmail]
  );

  const emailControl = register("email", {
    value: "",
    required: true,
  });

  const repeatEmailControl = register("repeatEmail", {
    value: "",
    required: true,
  });

  // reset the form on success
  useEffect(() => {
    if (updateUserMutation.data) {
      reset();
    }
  }, [reset, updateUserMutation.data]);

  return (
    <form data-cy="update-email-form" onSubmit={handleSubmit(onSubmit)}>
      <If condition={updateUserMutation.data}>
        <Alert type="success">
          <Alert.Heading>Email update request successful</Alert.Heading>
          We sent you an email to confirm your new email address. Please check
          your inbox and click on the link to confirm your new email address.
        </Alert>
      </If>

      <div className="flex flex-col space-y-4">
        <TextField>
          <TextField.Label>
            Your New Email
            <TextField.Input
              {...emailControl}
              data-cy="profile-new-email-input"
              required
              type="email"
              placeholder=""
            />
          </TextField.Label>
        </TextField>

        <TextField>
          <TextField.Label>
            Repeat Email
            <TextField.Input
              {...repeatEmailControl}
              data-cy="profile-repeat-email-input"
              required
              type="email"
            />
          </TextField.Label>
        </TextField>

        <div>
          <Button
            className="w-full md:w-auto"
            loading={updateUserMutation.isMutating}
          >
            Update Email Address
          </Button>
        </div>
      </div>
    </form>
  );
};

export default UpdateEmailForm;
