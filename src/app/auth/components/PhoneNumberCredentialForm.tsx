"use client";

import type { FormEventHandler } from "react";
import { useCallback } from "react";
import toaster from "react-hot-toast";
import Trans from "~/core/ui/Trans";
import { useTranslation } from "react-i18next";

import If from "~/core/ui/If";
import TextField from "~/core/ui/TextField";
import Button from "~/core/ui/Button";

import useUpdateUserMutation from "~/core/hooks/use-update-user-mutation";

const PhoneNumberCredentialForm: React.FC<{
  onSuccess: (phoneNumber: string) => void;
  action: string;
}> = ({ onSuccess, action }) => {
  const { t } = useTranslation();
  const updateUserMutation = useUpdateUserMutation();

  const onLinkPhoneNumberSubmit: FormEventHandler<HTMLFormElement> =
    useCallback(
      async (event) => {
        event.preventDefault();

        const data = new FormData(event.currentTarget);
        const phone = data.get("phoneNumber") as string;

        const promise = updateUserMutation.trigger({ phone });

        await toaster.promise(promise, {
          loading: t<string>(`profile:verifyPhoneNumberLoading`),
          success: t<string>(`profile:verifyPhoneNumberSuccess`),
          error: t<string>(`profile:verifyPhoneNumberError`),
        });

        onSuccess(phone);
      },
      [onSuccess, t, updateUserMutation]
    );

  return (
    <form className="w-full" onSubmit={onLinkPhoneNumberSubmit}>
      <div className="flex flex-col space-y-2">
        <TextField.Label>
          <Trans i18nKey="profile:phoneNumberLabel" />

          <TextField.Input
            required
            pattern="^\\+?[1-9]\\d{1,14}$"
            name="phoneNumber"
            type="tel"
            placeholder="Ex. +919367788755"
            disabled={updateUserMutation.isMutating}
          />
        </TextField.Label>

        <Button size="large" block type="submit">
          <If condition={action === "link"}>
            <Trans i18nKey="profile:verifyPhoneNumberSubmitLabel" />
          </If>

          <If condition={action === "signIn"}>
            <Trans i18nKey="auth:signInWithPhoneNumber" />
          </If>
        </Button>
      </div>
    </form>
  );
};

export default PhoneNumberCredentialForm;
