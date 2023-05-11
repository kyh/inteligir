"use client";

import { useCallback, type FormEventHandler } from "react";
import toaster from "react-hot-toast";
import useUpdateUserMutation from "~/core/hooks/use-update-user-mutation";
import Button from "~/components/Button";
import If from "~/components/If";
import TextField from "~/components/TextField";

const PhoneNumberCredentialForm: React.FC<{
  onSuccess: (phoneNumber: string) => void;
  action: string;
}> = ({ onSuccess, action }) => {
  const updateUserMutation = useUpdateUserMutation();

  const onLinkPhoneNumberSubmit: FormEventHandler<HTMLFormElement> =
    useCallback(
      async (event) => {
        event.preventDefault();

        const data = new FormData(event.currentTarget);
        const phone = data.get("phoneNumber") as string;

        const promise = updateUserMutation.trigger({ phone });

        await toaster.promise(promise, {
          loading: "Linking phone number...",
          success: "Phone number linked successfully",
          error: "Error linking phone number",
        });

        onSuccess(phone);
      },
      [onSuccess, updateUserMutation]
    );

  return (
    <form className="w-full" onSubmit={onLinkPhoneNumberSubmit}>
      <div className="flex flex-col space-y-2">
        <TextField.Label>
          Phone Number
          <TextField.Input
            required
            pattern="^\\+?[1-9]\\d{1,14}$"
            name="phoneNumber"
            type="tel"
            placeholder="Ex. +919367788755"
            disabled={updateUserMutation.isMutating}
          />
        </TextField.Label>

        <Button type="submit">
          <If condition={action === "link"}>Link Phone Number</If>
          <If condition={action === "signIn"}>Sign in with Phone Number</If>
        </Button>
      </div>
    </form>
  );
};

export default PhoneNumberCredentialForm;
